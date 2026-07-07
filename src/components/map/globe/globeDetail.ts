// Zoom-driven level-of-detail for the globe: the closer the camera dollies,
// the more map emerges. The base parchment texture is fixed-resolution, so
// past a zoom threshold its borders soften — these layers take over with
// true vector geometry that stays razor-sharp at any altitude:
//
//   Layer 1 — WORLD BORDERS: every country outline from the 50m atlas as one
//   merged LineSegments buffer on the sphere, fading in as the texture's own
//   borders start to blur. Hidden when zoomed out, so the far view keeps its
//   soft painted-atlas look.
//
//   Layer 2 — SUB-NATIONAL: when the camera hovers low over a country that
//   has admin-1 data (registry: jp/us/kr today), its states/provinces/
//   prefectures fade in — internal borders plus small ink-on-parchment name
//   labels. Only the FOCUSED country's detail is ever GPU-resident: it is
//   disposed on zoom-out or when the camera drifts to another country (the
//   parsed geometry stays in the loaders' module caches, so returning is
//   cheap).
//
//   Layer 3 — MUNICIPALITIES (市区町村): the deepest band. When the focused
//   country also has admin-2 data (jp today, 1742 polygons), its municipality
//   borders fade in as the finest, lightest ink — the line-weight hierarchy
//   country > prefecture > municipality makes the granularity read at a
//   glance. The source geometry is ~220m-simplified, so this tier only
//   appears at the closest zoom, after prefectures are already fully inked.
//   Borders only, no labels (1742 names would be noise; the collection UI
//   owns naming).
//
// All fades are functions of camera distance — direct manipulation, not
// time-based animation — so prefers-reduced-motion users still get the
// detail (it's content); only the short load-in fade is skipped for them.
// Colors come from the shared GlobePalette: fine ink lines, never neon.

import * as THREE from "three";
import type { MultiPolygon, Polygon } from "geojson";
import { lookupCountry, type CountryFeature } from "../../../lib/geo";
import { getLanguage } from "../../../lib/i18n";
import { clamp } from "../geoMath";
import { SUBNATIONAL_COUNTRY_CODES } from "../subnational/registry";
import { loadCountry } from "../subnational/subnationalGeo";
import { hasMunicipalData, loadMunicipalities, type Municipality } from "../municipal/municipalGeo";
import { geometryAnchor, latLngToVec3, wrapLng, type LatLng } from "./geoSphere";
import { mixHex, type GlobePalette } from "./globeTexture";

// --- LOD thresholds (camera distance; globe radius 1, dolly range 1.16–3.4) ----

/** Country vector borders start fading in below this altitude… */
export const COUNTRY_BORDER_FADE_IN = 2.35;
/** …and are fully inked by here (roughly where the 4k texture starts to blur). */
export const COUNTRY_BORDER_FULL = 1.85;
// The tiers' max alphas ARE the line-weight hierarchy: WebGL lines are fixed
// at 1px, so opacity (plus a lightened ink for municipalities) is what makes
// country read heaviest, prefecture medium, municipality finest.
const COUNTRY_BORDER_ALPHA = 0.55;

/** Below this the focused country's admin-1 layer loads + starts fading in. */
export const SUBNATIONAL_FADE_IN = 1.62;
export const SUBNATIONAL_FULL = 1.42;
/** GPU-dispose above this — hysteresis so hovering at the threshold doesn't thrash. */
export const SUBNATIONAL_EXIT = 1.78;
const SUBNATIONAL_ALPHA = 0.48;

/** Names arrive once subdivisions are legibly large. */
export const LABEL_FADE_IN = 1.5;
export const LABEL_FULL = 1.32;
const LABEL_ALPHA = 0.92;

/** Municipality tier: the chunk load kicks off here — prefectures are fully
 *  inked by now, so the ~2.3MB geojson is usually parsed before the band opens. */
export const MUNICIPAL_PRELOAD = 1.4;
/** Borders fade in below this — the LAST detail to appear… */
export const MUNICIPAL_FADE_IN = 1.32;
export const MUNICIPAL_FULL = 1.24;
/** …and GPU-dispose above this (hysteresis around the whole deep band). */
export const MUNICIPAL_EXIT = 1.45;
const MUNICIPAL_ALPHA = 0.3;

const COUNTRY_LINE_RADIUS = 1.002;
const SUB_LINE_RADIUS = 1.0028;
const MUNI_LINE_RADIUS = 1.0024;
const LABEL_RADIUS = 1.006;
const LABEL_SCREEN_PX = 13; // on-screen text height
const MAX_LABELS = 90;
const LOOKUP_THROTTLE_MS = 400;
const BIRTH_FADE_MS = 350;

function ramp(dist: number, fadeIn: number, full: number): number {
  if (dist >= fadeIn) return 0;
  if (dist <= full) return 1;
  return (fadeIn - dist) / (fadeIn - full);
}

// Pure, exported for the unit test: opacity as a function of camera distance.
export function countryBorderOpacity(dist: number): number {
  return ramp(dist, COUNTRY_BORDER_FADE_IN, COUNTRY_BORDER_FULL) * COUNTRY_BORDER_ALPHA;
}
export function subnationalOpacity(dist: number): number {
  return ramp(dist, SUBNATIONAL_FADE_IN, SUBNATIONAL_FULL) * SUBNATIONAL_ALPHA;
}
export function labelOpacity(dist: number): number {
  return ramp(dist, LABEL_FADE_IN, LABEL_FULL) * LABEL_ALPHA;
}
export function municipalOpacity(dist: number): number {
  return ramp(dist, MUNICIPAL_FADE_IN, MUNICIPAL_FULL) * MUNICIPAL_ALPHA;
}

// --- geometry ---------------------------------------------------------------------

/**
 * One merged LineSegments buffer for a set of polygon borders on the sphere.
 * Exported for the unit test (a closed ring of N points yields N segments).
 */
export function buildBorderGeometry(
  geometries: readonly (Polygon | MultiPolygon)[],
  radius: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const addRing = (ring: number[][]) => {
    for (let i = 0; i + 1 < ring.length; i++) {
      positions.push(
        ...latLngToVec3(ring[i][1], ring[i][0], radius),
        ...latLngToVec3(ring[i + 1][1], ring[i + 1][0], radius),
      );
    }
  };
  for (const geometry of geometries) {
    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) addRing(ring);
    } else {
      for (const poly of geometry.coordinates) for (const ring of poly) addRing(ring);
    }
  }
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return buffer;
}

// --- sub-national data (jp lives apart from the generic us/kr loader) -------------

interface DetailRegion {
  name: string;
  nameLocal: string;
  geometry: Polygon | MultiPolygon;
}

/** App language in which a country's local-script names are the native read. */
const LOCAL_LANG: Record<string, string> = { jp: "ja", kr: "ko", us: "en" };

/**
 * Japan's prefecture data ships with japanGeo.ts (registry kind "japan"),
 * everything else with subnationalGeo. japanGeo is reached via dynamic
 * import: it transitively pulls hooks/store modules that a static import
 * would drag into this file's graph for no render-path benefit.
 */
function loadRegions(code: string): Promise<DetailRegion[]> {
  if (code === "jp") {
    return import("../japanGeo").then((mod) =>
      mod
        .loadJapanPrefectures()
        .then((prefs) => prefs.map((p) => ({ name: p.name, nameLocal: p.name_ja, geometry: p.geometry }))),
    );
  }
  return loadCountry(code).then((subs) =>
    subs.map((s) => ({ name: s.name, nameLocal: s.name_local, geometry: s.geometry })),
  );
}

// --- the detail manager --------------------------------------------------------------

interface LineLayer {
  lines: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
}

interface LabelEntry {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  text: string;
  aspect: number; // canvas width / height
}

interface SubLayer {
  code: string;
  group: THREE.Group;
  lineGeometry: THREE.BufferGeometry;
  lineMaterial: THREE.LineBasicMaterial;
  labels: LabelEntry[];
  /** When the layer finished building — drives the short load-in fade. */
  birth: number;
}

interface MuniLayer {
  lines: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  birth: number;
}

// loadMunicipalities returns the SAME parsed array on every call, so the
// tessellated buffer can be keyed on it: leaving the deep band frees the GPU
// copy (geometry.dispose()), and diving back re-uploads the cached CPU
// attributes instead of re-walking 1742 polygons.
const muniGeometryCache = new WeakMap<readonly Municipality[], THREE.BufferGeometry>();

export class GlobeDetail {
  private parent: THREE.Object3D;
  private palette: GlobePalette;
  private onNeedsRender: () => void;

  private worldFeatures: CountryFeature[] | null = null;
  private countryLayer: LineLayer | null = null;
  private cancelIdleBuild: (() => void) | null = null;

  private focusCode = "";
  private lookupBusy = false;
  private lastLookupAt = 0;
  /** Center the last COMPLETED lookup resolved — while the live center stays
   *  near it there is nothing new to resolve, and rendering can go idle. */
  private lastResolvedCenter: LatLng | null = null;
  private subLayer: SubLayer | null = null;
  private muniLayer: MuniLayer | null = null;
  private muniLoading = false;
  /** Camera distance as of the last update — the async municipality load
   *  checks it so a chunk that arrives after zoom-out isn't built. */
  private lastDist = Number.POSITIVE_INFINITY;

  private disposed = false;
  private scratch = new THREE.Vector3();

  constructor(parent: THREE.Object3D, palette: GlobePalette, onNeedsRender: () => void) {
    this.parent = parent;
    this.palette = palette;
    this.onNeedsRender = onNeedsRender;
  }

  /** World geometry arrived — build the border buffer off the interaction
   *  path (idle callback) so the first zoom-in never hitches on it. */
  setWorld(features: CountryFeature[]): void {
    this.worldFeatures = features;
    this.cancelIdleBuild?.();
    const build = () => {
      this.cancelIdleBuild = null;
      this.buildCountryLayer();
    };
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(build, { timeout: 4000 });
      this.cancelIdleBuild = () => cancelIdleCallback(handle);
    } else {
      const handle = setTimeout(build, 300);
      this.cancelIdleBuild = () => clearTimeout(handle);
    }
  }

  setPalette(palette: GlobePalette): void {
    this.palette = palette;
    if (this.countryLayer) this.countryLayer.material.color.set(palette.detailInk);
    if (this.subLayer) {
      this.subLayer.lineMaterial.color.set(palette.detailInk);
      for (const label of this.subLayer.labels) {
        this.paintLabel(label.canvas, label.text);
        label.texture.needsUpdate = true;
      }
    }
    if (this.muniLayer) this.muniLayer.material.color.set(this.muniInk());
  }

  /** After a restored WebGL context every canvas texture must re-upload. */
  markTexturesDirty(): void {
    if (this.subLayer) for (const label of this.subLayer.labels) label.texture.needsUpdate = true;
  }

  /**
   * Per rendered frame (the scene's render-on-demand loop only calls this
   * while something is already drawing). Returns true while the load-in fade
   * still needs further frames.
   */
  update(
    camera: THREE.PerspectiveCamera,
    dist: number,
    center: LatLng,
    heightPx: number,
    reducedMotion: boolean,
    now: number,
  ): boolean {
    let busy = false;
    this.lastDist = dist;

    if (this.countryLayer) {
      const opacity = countryBorderOpacity(dist);
      this.countryLayer.material.opacity = opacity;
      this.countryLayer.lines.visible = opacity > 0.004;
    }

    // Focus lifecycle: acquire under the enter altitude, release above the
    // exit altitude (hysteresis band in between keeps the layer stable).
    // A pending refocus (throttled or in flight) keeps frames coming so a
    // dolly-and-release still resolves once the throttle window passes.
    if (dist <= SUBNATIONAL_FADE_IN) {
      if (this.maybeRefocus(center, now)) busy = true;
    } else if (dist >= SUBNATIONAL_EXIT && (this.subLayer || this.focusCode)) {
      this.clearSubLayer();
    }

    const layer = this.subLayer;
    if (layer) {
      // Detail is content: reduced motion skips only the timed load-in fade.
      const birth = reducedMotion ? 1 : clamp((now - layer.birth) / BIRTH_FADE_MS, 0, 1);
      if (birth < 1) busy = true;
      const lineOp = subnationalOpacity(dist) * birth;
      layer.lineMaterial.opacity = lineOp;
      const labelOp = labelOpacity(dist) * birth;
      layer.group.visible = lineOp > 0.004 || labelOp > 0.004;
      if (layer.group.visible && layer.labels.length > 0) {
        // Constant on-screen size, same optics as the photo billboards.
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        for (const label of layer.labels) {
          label.material.opacity = labelOp;
          label.sprite.visible = labelOp > 0.004;
          if (!label.sprite.visible) continue;
          const d = camera.position.distanceTo(label.sprite.position);
          const h = (LABEL_SCREEN_PX * 2 * d * tanHalf) / Math.max(1, heightPx);
          label.sprite.scale.set(h * label.aspect, h, 1);
        }
      }
    }

    // Layer 3 — municipality tier, the deepest band. Rides the sub-national
    // focus (clearSubLayer tears it down too); its own enter/exit hysteresis
    // handles the zoom-out-a-little-then-back-in case without a reload.
    if (this.focusCode && hasMunicipalData(this.focusCode) && dist <= MUNICIPAL_PRELOAD) {
      this.ensureMuniLayer();
    }
    if (this.muniLayer && dist >= MUNICIPAL_EXIT) this.clearMuniLayer();
    const muni = this.muniLayer;
    if (muni) {
      const birth = reducedMotion ? 1 : clamp((now - muni.birth) / BIRTH_FADE_MS, 0, 1);
      if (birth < 1) busy = true;
      const opacity = municipalOpacity(dist) * birth;
      muni.material.opacity = opacity;
      muni.lines.visible = opacity > 0.004;
    }

    return busy;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelIdleBuild?.();
    this.cancelIdleBuild = null;
    this.clearSubLayer();
    if (this.countryLayer) {
      this.parent.remove(this.countryLayer.lines);
      this.countryLayer.lines.geometry.dispose();
      this.countryLayer.material.dispose();
      this.countryLayer = null;
    }
  }

  // --- layer 1: world borders ---------------------------------------------------------

  private buildCountryLayer(): void {
    if (this.disposed || this.countryLayer || !this.worldFeatures) return;
    const geometry = buildBorderGeometry(
      this.worldFeatures.map((f) => f.geometry),
      COUNTRY_LINE_RADIUS,
    );
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.palette.detailInk),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.visible = false;
    lines.renderOrder = 2; // above the reveal overlay, below photos/pins
    this.parent.add(lines);
    this.countryLayer = { lines, material };
    this.onNeedsRender();
  }

  // --- layer 2: sub-national focus ------------------------------------------------------

  /** Returns true while a refocus is still wanted (throttled or in flight). */
  private maybeRefocus(center: LatLng, now: number): boolean {
    if (this.lastResolvedCenter) {
      const dLat = Math.abs(center.lat - this.lastResolvedCenter.lat);
      const dLng = Math.abs(wrapLng(center.lng - this.lastResolvedCenter.lng)) * Math.cos((center.lat * Math.PI) / 180);
      if (dLat + dLng < 0.15) return false; // settled over the same spot
    }
    if (this.lookupBusy || now - this.lastLookupAt < LOOKUP_THROTTLE_MS) return true;
    this.lastLookupAt = now;
    this.lookupBusy = true;
    const snapshot: LatLng = { lat: center.lat, lng: center.lng };
    void lookupCountry(center.lat, center.lng)
      .then((code) => {
        this.lookupBusy = false;
        if (this.disposed) return;
        this.lastResolvedCenter = snapshot;
        const target = SUBNATIONAL_COUNTRY_CODES.includes(code) ? code : "";
        if (target === this.focusCode) return;
        this.clearSubLayer();
        this.lastResolvedCenter = snapshot; // clearSubLayer nulled it
        this.focusCode = target;
        if (!target) return;
        void loadRegions(target)
          .then((regions) => {
            // The camera may have moved on (or out) while the chunk loaded.
            if (this.disposed || this.focusCode !== target || this.subLayer || regions.length === 0) return;
            this.buildSubLayer(target, regions);
            this.onNeedsRender();
          })
          .catch(() => {
            // Chunk unreachable (offline) — forget the focus so a later
            // approach retries; the loaders un-cache failures themselves.
            if (this.focusCode === target) this.focusCode = "";
          });
      })
      .catch(() => {
        this.lookupBusy = false;
      });
    return true;
  }

  private buildSubLayer(code: string, regions: DetailRegion[]): void {
    const group = new THREE.Group();
    group.visible = false;

    const lineGeometry = buildBorderGeometry(
      regions.map((r) => r.geometry),
      SUB_LINE_RADIUS,
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.palette.detailInk),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.renderOrder = 2;
    group.add(lines);

    // Subtle place names, local script when the app speaks that language.
    const useLocal = LOCAL_LANG[code] === getLanguage();
    const labels: LabelEntry[] = [];
    for (const region of regions.slice(0, MAX_LABELS)) {
      const anchor = geometryAnchor(region.geometry);
      if (!anchor) continue;
      const text = (useLocal && region.nameLocal) || region.name;
      if (!text) continue;
      const label = this.makeLabel(text);
      this.scratch.set(...latLngToVec3(anchor.lat, anchor.lng, LABEL_RADIUS));
      label.sprite.position.copy(this.scratch);
      group.add(label.sprite);
      labels.push(label);
    }

    this.parent.add(group);
    this.subLayer = { code, group, lineGeometry, lineMaterial, labels, birth: performance.now() };
  }

  private clearSubLayer(): void {
    this.clearMuniLayer(); // the deepest tier never outlives its country focus
    this.focusCode = "";
    this.lastResolvedCenter = null; // re-approaching must re-resolve
    const layer = this.subLayer;
    if (!layer) return;
    this.subLayer = null;
    this.parent.remove(layer.group);
    layer.lineGeometry.dispose();
    layer.lineMaterial.dispose();
    for (const label of layer.labels) {
      label.material.dispose();
      label.texture.dispose();
    }
    this.onNeedsRender();
  }

  // --- layer 3: municipalities ----------------------------------------------------------

  /** The lightest ink in the hierarchy: detailInk pulled toward the fog
   *  stroke, so municipal lines read as pencil under the prefecture pen. */
  private muniInk(): string {
    return mixHex(this.palette.detailInk, this.palette.fogStroke, 0.4);
  }

  private ensureMuniLayer(): void {
    if (this.muniLayer || this.muniLoading || this.disposed) return;
    const code = this.focusCode;
    this.muniLoading = true;
    void loadMunicipalities(code)
      .then((munis) => {
        this.muniLoading = false;
        // The camera may have left the deep band (or the country) while the
        // ~2.3MB chunk loaded — skip; the parsed data stays cached for the
        // next dive, so retrying costs only the buffer re-upload.
        if (this.disposed || this.focusCode !== code || this.muniLayer) return;
        if (this.lastDist >= MUNICIPAL_EXIT || munis.length === 0) return;
        this.buildMuniLayer(munis);
        this.onNeedsRender();
      })
      .catch(() => {
        // Chunk unreachable (offline) — allow a retry on the next approach;
        // loadMunicipalities un-caches its own failures.
        this.muniLoading = false;
      });
  }

  private buildMuniLayer(munis: readonly Municipality[]): void {
    let geometry = muniGeometryCache.get(munis);
    if (!geometry) {
      geometry = buildBorderGeometry(
        munis.map((m) => m.geometry),
        MUNI_LINE_RADIUS,
      );
      muniGeometryCache.set(munis, geometry);
    }
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.muniInk()),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.visible = false;
    lines.renderOrder = 2;
    this.parent.add(lines);
    this.muniLayer = { lines, material, birth: performance.now() };
  }

  private clearMuniLayer(): void {
    const layer = this.muniLayer;
    if (!layer) return;
    this.muniLayer = null;
    this.parent.remove(layer.lines);
    // Frees the GPU buffers only — the CPU-side attributes stay keyed in
    // muniGeometryCache and re-upload on the next deep dive.
    layer.lines.geometry.dispose();
    layer.material.dispose();
    this.onNeedsRender();
  }

  // --- labels ------------------------------------------------------------------------------

  private paintLabel(canvas: HTMLCanvasElement, text: string): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    // Parchment halo under the ink keeps names readable over busy borders.
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = this.palette.fogFill;
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = this.palette.detailLabel;
    ctx.fillText(text, cx, cy);
  }

  private makeLabel(text: string): LabelEntry {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let width = 120;
    if (ctx) {
      ctx.font = LABEL_FONT;
      width = Math.ceil(ctx.measureText(text).width) + 16;
    }
    canvas.width = Math.max(2, width);
    canvas.height = 40;
    this.paintLabel(canvas, text);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false; // arbitrary (non-POT) widths
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthTest: true, // the sphere hides far-side names
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 4;
    return { sprite, material, texture, canvas, text, aspect: canvas.width / canvas.height };
  }
}

// 26px drawn, ~13px on screen — 2x supersampling keeps CJK glyphs crisp.
const LABEL_FONT = '600 26px system-ui, "Noto Sans JP", "Noto Sans", sans-serif';

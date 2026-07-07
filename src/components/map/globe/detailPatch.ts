// Zoom-in sharpness patch for the globe's painted texture. The base atlas
// (globeTexture.ts's paintGlobeBase) wraps the WHOLE sphere in one canvas —
// fine from orbit, but at the closest dolly the screen shows only a sliver
// of it, so the land/ocean fill and country fills go visibly soft (the
// vector LOD in globeDetail.ts already keeps borders sharp; this covers the
// painted fill underneath).
//
// The fix is not a higher-res whole-globe texture (memory-prohibitive at the
// density this needs) but a small high-density canvas repainted for JUST the
// geographic window the camera is currently looking at, draped on a matching
// sphere-segment mesh that sits a hair above the base globe. It reuses
// paintGlobeBase verbatim — same palette, same pre-built Path2D country
// paths — via an optional viewport rect, so the patch is pixel-for-pixel the
// same painting, just zoomed in on the canvas the way a loupe zooms a map.
//
// Repaints happen only once the camera has settled (a short debounce) and
// only when the visible window has drifted far enough from the one last
// painted — never per frame. Fade-in/out is camera-distance-driven (direct
// manipulation, matching globeDetail's convention) with a short load-in fade
// and zoom-out hysteresis so hovering at the threshold doesn't thrash the
// canvas.

import * as THREE from "three";
import { COUNTRY_BORDER_FULL } from "./globeDetail";
import { shortestAngle, vec3ToLatLng, wrapLng } from "./geoSphere";
import { paintGlobeBase, type CountryPath, type GlobePalette } from "./globeTexture";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// --- LOD thresholds (camera distance; globe radius 1) ------------------------

// COUNTRY_BORDER_FULL is globeDetail's own note for "roughly where the 4k
// texture starts to blur" — the exact moment this patch should take over.
export const PATCH_FADE_IN = COUNTRY_BORDER_FULL;
export const PATCH_FULL = 1.45;
/** GPU-dispose above this — hysteresis so hovering at the threshold doesn't thrash. */
export const PATCH_EXIT = PATCH_FADE_IN + 0.15;
const PATCH_ALPHA = 1;

function ramp(dist: number, fadeIn: number, full: number): number {
  if (dist >= fadeIn) return 0;
  if (dist <= full) return 1;
  return (fadeIn - dist) / (fadeIn - full);
}

/** Pure, exported for the unit test: opacity as a function of camera distance. */
export function patchOpacity(dist: number): number {
  return ramp(dist, PATCH_FADE_IN, PATCH_FULL) * PATCH_ALPHA;
}

// --- window computation -------------------------------------------------------

export interface GeoWindow {
  centerLat: number;
  centerLng: number;
  latMin: number;
  latMax: number;
  /** Continuous (unwrapped) degrees relative to no fixed origin — may run
   *  outside [-180, 180]. Kept unwrapped so a window straddling the ±180°
   *  seam stays a single monotonic range instead of jumping discontinuously. */
  lngMin: number;
  lngMax: number;
}

const MARGIN_DEG = 6; // pads the window so small drift after a repaint doesn't immediately go stale
const MAX_LAT = 89;

// Screen-space NDC samples: four corners plus edge midpoints, the latter so
// an ultra-wide viewport (horizontal FOV > the nominal vertical 45°) still
// gets its true horizontal extent rather than just the corners' diagonal.
const NDC_SAMPLES: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * The lat/lng rectangle currently visible on the sphere, found by ray-sphere
 * intersecting the viewport's corners (+ edge midpoints) against the unit
 * globe. Returns null only if every sample misses the sphere (shouldn't
 * happen within this patch's operating dolly range, but the camera's FOV
 * cone is checked rather than assumed).
 */
export function computeVisibleWindow(camera: THREE.PerspectiveCamera, sphereRadius = 1, marginDeg = MARGIN_DEG): GeoWindow | null {
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), sphereRadius);
  const raycaster = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  const center = vec3ToLatLng(camera.position.x, camera.position.y, camera.position.z);
  const centerLngRad = center.lng * DEG2RAD;

  let latMin = center.lat;
  let latMax = center.lat;
  let lngOffMin = 0;
  let lngOffMax = 0;
  let anyHit = false;

  for (const [nx, ny] of NDC_SAMPLES) {
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    if (!raycaster.ray.intersectSphere(sphere, hit)) continue;
    anyHit = true;
    const ll = vec3ToLatLng(hit.x, hit.y, hit.z);
    if (ll.lat < latMin) latMin = ll.lat;
    if (ll.lat > latMax) latMax = ll.lat;
    // Shortest signed offset from center, in radians — continuous across the
    // ±180° seam (unlike a plain lng subtraction), so min/max stay monotonic.
    const offDeg = shortestAngle(centerLngRad, ll.lng * DEG2RAD) * RAD2DEG;
    if (offDeg < lngOffMin) lngOffMin = offDeg;
    if (offDeg > lngOffMax) lngOffMax = offDeg;
  }
  if (!anyHit) return null;

  return {
    centerLat: center.lat,
    centerLng: center.lng,
    latMin: Math.max(-MAX_LAT, latMin - marginDeg),
    latMax: Math.min(MAX_LAT, latMax + marginDeg),
    lngMin: center.lng + lngOffMin - marginDeg,
    lngMax: center.lng + lngOffMax + marginDeg,
  };
}

/** Great-circle-ish drift between two windows' centers, in degrees — pure,
 *  exported for the unit test's repaint-decision checks. */
export function windowDriftDeg(a: GeoWindow, b: GeoWindow): number {
  const dLat = Math.abs(a.centerLat - b.centerLat);
  const dLng = Math.abs(shortestAngle(a.centerLng * DEG2RAD, b.centerLng * DEG2RAD) * RAD2DEG);
  return Math.max(dLat, dLng);
}

const DRIFT_REBUILD_DEG = 6;

/**
 * Whether a freshly-computed window is different enough from the last one
 * painted to justify a repaint (a new canvas + texture upload). Pure so the
 * decision is unit-testable without a camera or canvas.
 */
export function shouldRebuildPatch(current: GeoWindow, built: GeoWindow | null): boolean {
  if (!built) return true;
  if (windowDriftDeg(current, built) >= DRIFT_REBUILD_DEG) return true;
  // Zoom band change: a much tighter/looser window than what's built means
  // the current patch would look either wastefully coarse or unnecessarily
  // cropped versus what the camera can now see.
  const spanNow = Math.max(current.latMax - current.latMin, current.lngMax - current.lngMin);
  const spanBuilt = Math.max(built.latMax - built.latMin, built.lngMax - built.lngMin);
  return spanNow < spanBuilt * 0.7 || spanNow > spanBuilt * 1.4;
}

// --- base-canvas pixel window (for the viewport-transform repaint) -----------

export interface PixelWindow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Converts a GeoWindow into the base atlas's pixel space, anchored at the
 * window center's wrapped position and extended by continuous (unwrapped)
 * degree offsets — so a window straddling the antimeridian yields a
 * monotonic (if out-of-[0, baseW] range) rect rather than a discontinuity.
 * detailPatch draws this rect (and its ±baseW tiles) through paintGlobeBase's
 * viewport param, mimicking the base texture's RepeatWrapping.
 */
export function geoWindowToPixelWindow(win: GeoWindow, baseW: number, baseH: number): PixelWindow {
  const pxPerDegLng = baseW / 360;
  const xCenter = ((wrapLng(win.centerLng) + 180) / 360) * baseW;
  return {
    x0: xCenter + (win.lngMin - win.centerLng) * pxPerDegLng,
    x1: xCenter + (win.lngMax - win.centerLng) * pxPerDegLng,
    y0: ((90 - win.latMax) / 180) * baseH,
    y1: ((90 - win.latMin) / 180) * baseH,
  };
}

// --- patch canvas sizing --------------------------------------------------------

const TARGET_PX_PER_DEG = 64; // far denser than any whole-globe atlas could afford
const PATCH_MIN_DIM = 384;
const PATCH_MAX_DIM = 2048;

/** Canvas pixel dimensions for a window, denser than the base atlas but capped
 *  for texture memory. Keeps the SAME px/deg on both axes (equirectangular,
 *  no distortion) so borders read the same weight in every direction. */
export function patchCanvasSize(win: GeoWindow, maxDim = PATCH_MAX_DIM): { width: number; height: number } {
  const spanLng = Math.max(0.01, win.lngMax - win.lngMin);
  const spanLat = Math.max(0.01, win.latMax - win.latMin);
  const pxPerDeg = Math.min(TARGET_PX_PER_DEG, maxDim / spanLng, maxDim / spanLat);
  return {
    width: Math.round(Math.min(maxDim, Math.max(PATCH_MIN_DIM, spanLng * pxPerDeg))),
    height: Math.round(Math.min(maxDim, Math.max(PATCH_MIN_DIM, spanLat * pxPerDeg))),
  };
}

// --- sphere-segment geometry ---------------------------------------------------

const WIDTH_SEGMENTS = 48;
const HEIGHT_SEGMENTS = 36;

/**
 * A sphere segment exactly covering the window, a hair above the base globe
 * so it draws over the (lower-res) base texture without z-fighting. Uses the
 * SAME phi/theta convention as geoSphere.ts's latLngToVec3 (verified there
 * against three's own SphereGeometry), so the patch aligns with the base
 * sphere and every other layer without any extra rotation math.
 */
export function buildPatchGeometry(win: GeoWindow, radius: number): THREE.SphereGeometry {
  const thetaStart = (90 - win.latMax) * DEG2RAD;
  const thetaLength = (win.latMax - win.latMin) * DEG2RAD;
  const phiStart = (win.lngMin + 180) * DEG2RAD;
  const phiLength = (win.lngMax - win.lngMin) * DEG2RAD;
  return new THREE.SphereGeometry(radius, WIDTH_SEGMENTS, HEIGHT_SEGMENTS, phiStart, phiLength, thetaStart, thetaLength);
}

// --- windowed repaint (tiles ±baseW so an antimeridian-straddling window still paints correctly) --

/**
 * Repaints ctx (sized to a patch canvas) with just `win`'s content, reusing
 * paintGlobeBase verbatim. Country Path2D coordinates live in [0, baseW) —
 * a window that straddles the seam has a pixel rect that runs outside that
 * range, so this tries the rect at -baseW/0/+baseW offsets; whichever
 * offset(s) actually overlap [0, baseW] contribute their slice, and the rest
 * are cheap no-ops (fully outside the canvas's physical bounds).
 */
export function paintPatch(
  ctx: CanvasRenderingContext2D,
  baseW: number,
  baseH: number,
  pixelWindow: PixelWindow,
  paths: readonly CountryPath[],
  visited: ReadonlySet<string>,
  palette: GlobePalette,
): void {
  for (const dx of [-baseW, 0, baseW]) {
    const viewport = { x0: pixelWindow.x0 + dx, y0: pixelWindow.y0, x1: pixelWindow.x1 + dx, y1: pixelWindow.y1 };
    if (viewport.x1 <= 0 || viewport.x0 >= baseW) continue; // no overlap with the atlas's valid domain
    paintGlobeBase(ctx, baseW, baseH, paths, visited, palette, viewport);
  }
}

// --- the patch manager ----------------------------------------------------------

const SETTLE_MS = 220; // camera must be still this long before a repaint fires
const MOVE_EPSILON_SQ = 1e-7;
const BIRTH_FADE_MS = 300;
const PATCH_RADIUS = 1.001; // above the globe (1), below the vector detail layers (>=1.002)

interface PatchMesh {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  window: GeoWindow;
  birth: number;
}

export class GlobeDetailPatch {
  private parent: THREE.Object3D;
  private palette: GlobePalette;
  private maxTexSize: number;
  private onNeedsRender: () => void;

  private baseW = 0;
  private baseH = 0;
  private countryPaths: readonly CountryPath[] = [];
  private visited: ReadonlySet<string> = new Set();

  private patch: PatchMesh | null = null;
  private lastCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lastMoveAt = 0;
  private disposed = false;

  constructor(parent: THREE.Object3D, palette: GlobePalette, maxTexSize: number, onNeedsRender: () => void) {
    this.parent = parent;
    this.palette = palette;
    this.maxTexSize = maxTexSize;
    this.onNeedsRender = onNeedsRender;
  }

  /** World data changed — the paths are pre-built at (baseW, baseH) by the
   *  scene, exactly like the base texture, so the patch stays pixel-aligned
   *  with it. A rebuild is deferred to the next settle rather than forced. */
  setWorld(paths: readonly CountryPath[], baseW: number, baseH: number): void {
    this.countryPaths = paths;
    this.baseW = baseW;
    this.baseH = baseH;
    this.disposePatch(); // stale paths/dimensions — repaint fresh once settled
  }

  setVisited(visited: ReadonlySet<string>): void {
    this.visited = visited;
    this.disposePatch();
  }

  setPalette(palette: GlobePalette): void {
    this.palette = palette;
    this.disposePatch();
  }

  /** Per rendered frame, only while dist is within the fade band (the scene
   *  gates the call the same way GlobeDetail's layers do). Returns true while
   *  still busy (settling, fading in, or fading out) so the render-on-demand
   *  loop keeps ticking. */
  update(camera: THREE.PerspectiveCamera, dist: number, now: number): boolean {
    let busy = false;

    if (dist >= PATCH_EXIT) {
      if (this.patch) this.disposePatch();
      return false;
    }

    if (camera.position.distanceToSquared(this.lastCamPos) > MOVE_EPSILON_SQ) {
      this.lastMoveAt = now;
      this.lastCamPos.copy(camera.position);
    }
    const settled = now - this.lastMoveAt >= SETTLE_MS;
    const inBand = dist <= PATCH_FADE_IN && this.baseW > 0;

    if (inBand) {
      if (!settled) {
        // Camera is either still moving or within the settle window — the
        // render-on-demand loop would otherwise go idle the instant the
        // camera stops, before the settle timer had a chance to elapse, so
        // this keeps frames coming until we actually get to check it below.
        busy = true;
      } else {
        const window = computeVisibleWindow(camera);
        if (window && shouldRebuildPatch(window, this.patch?.window ?? null)) {
          this.rebuild(window, now);
        }
      }
    }

    if (this.patch) {
      const birth = clamp01((now - this.patch.birth) / BIRTH_FADE_MS);
      if (birth < 1) busy = true;
      const opacity = patchOpacity(dist) * birth;
      this.patch.material.opacity = opacity;
      this.patch.mesh.visible = opacity > 0.004;
    }

    return busy;
  }

  /** After a restored WebGL context every canvas texture must re-upload. */
  markTexturesDirty(): void {
    if (this.patch) this.patch.texture.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.disposePatch();
  }

  private rebuild(window: GeoWindow, now: number): void {
    if (this.disposed || this.countryPaths.length === 0) return;
    const pixelWindow = geoWindowToPixelWindow(window, this.baseW, this.baseH);
    const { width, height } = patchCanvasSize(window, Math.min(PATCH_MAX_DIM, this.maxTexSize));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintPatch(ctx, this.baseW, this.baseH, pixelWindow, this.countryPaths, this.visited, this.palette);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 1; // the patch already IS the high-res sample; anisotropy would just cost bandwidth
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
    const geometry = buildPatchGeometry(window, PATCH_RADIUS);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 0; // above the opaque globe, below the transparent reveal/detail layers
    this.parent.add(mesh);

    this.disposePatch();
    this.patch = { mesh, material, texture, canvas, window, birth: now };
    this.onNeedsRender();
  }

  private disposePatch(): void {
    const patch = this.patch;
    if (!patch) return;
    this.patch = null;
    this.parent.remove(patch.mesh);
    patch.mesh.geometry.dispose();
    patch.material.dispose();
    patch.texture.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

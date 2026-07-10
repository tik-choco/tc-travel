// Paints the equirectangular parchment atlas the globe wraps around: warm
// ocean, fine country outlines, fog over the unvisited world and a warm
// parchment→gold wash over visited lands. An equirectangular texture on a UV
// sphere preserves the sphere's true areas — the whole point of the globe —
// so all the artistry happens on a flat 2:1 canvas and the geometry stays
// honest. Colors are resolved from the live theme tokens (light AND dark) at
// paint time; repaints are rare (world load, new visit, theme flip), never
// per-frame.

import type { CountryFeature } from "../../../lib/geo";
import { latLngToEquirect } from "./geoSphere";

export interface GlobePalette {
  dark: boolean;
  oceanPole: string;
  oceanMid: string;
  oceanCore: string;
  fogFill: string;
  fogStroke: string;
  landNorth: string;
  landMid: string;
  landSouth: string;
  landStroke: string;
  landGlow: string;
  graticule: string;
  speckle: string;
  /** Fill of the reveal-flash overlay + burst flourish color. */
  flash: string;
  /** Atmospheric rim tint (hex — consumed by the scene's shader). */
  atmosphere: string;
  /** Encounter-pin seal fill (the map's wax-seal red). */
  pinSeal: string;
  /** Fine ink for the zoom-in vector border layers (globeDetail LOD). */
  detailInk: string;
  /** Sub-national label text color (its halo reuses fogFill). */
  detailLabel: string;
}

// --- tiny hex color kit (theme tokens are plain 6-digit hex) -----------------

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** Linear channel mix of two hex colors; falls back to `a` on parse failure. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const ch = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `#${[ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

// --- palette from the live theme ----------------------------------------------

// Mirrors of theme.css :root / dark, used when a token can't be read (tests,
// detached documents) so the painter never produces an unstyled canvas.
const LIGHT_FALLBACK: Record<string, string> = {
  "--surface-dim": "#ece1d4",
  "--surface-container-low": "#f7f0e4",
  "--outline": "#7c7263",
  "--outline-variant": "#dbcfbc",
  "--primary": "#00658f",
  "--primary-container": "#c8e6ff",
  "--tertiary-container": "#ffdbd1",
  "--on-surface": "#362f28",
  "--error": "#ba1a1a",
};
const DARK_FALLBACK: Record<string, string> = {
  "--surface-dim": "#0e0e13",
  "--surface-container-low": "#18181f",
  "--outline": "#55525f",
  "--outline-variant": "#34323e",
  "--primary": "#8dcdff",
  "--primary-container": "#004b6f",
  "--tertiary-container": "#723523",
  "--on-surface": "#e5e1ec",
  "--error": "#ffb4ab",
};

/** Follows lib/theme.ts's model: forced data-theme wins, else the OS. */
export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readGlobePalette(): GlobePalette {
  const dark = isDarkTheme();
  const fallback = dark ? DARK_FALLBACK : LIGHT_FALLBACK;
  const style = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const token = (name: string): string => {
    const v = style?.getPropertyValue(name).trim();
    return v && parseHex(v) ? v : fallback[name];
  };

  const surfaceDim = token("--surface-dim");
  const primary = token("--primary");
  const primaryContainer = token("--primary-container");
  const onSurface = token("--on-surface");
  const outline = token("--outline");

  return {
    dark,
    // Ocean: soft light at the equator band deepening toward the poles — the
    // sphere equivalent of the SVG map's old-atlas radial vignette.
    oceanCore: mixHex(surfaceDim, primary, 0.07),
    oceanMid: surfaceDim,
    oceanPole: mixHex(surfaceDim, onSurface, dark ? 0.2 : 0.12),
    fogFill: token("--surface-container-low"),
    fogStroke: token("--outline-variant"),
    // Visited land: same north→south warm drift as map.css's map-land-grad.
    landNorth: mixHex(primaryContainer, primary, 0.2),
    landMid: primaryContainer,
    landSouth: mixHex(primaryContainer, token("--tertiary-container"), 0.16),
    landStroke: mixHex(primary, primaryContainer, 0.1),
    landGlow: withAlpha(primary, 0.45),
    graticule: withAlpha(outline, 0.3),
    speckle: withAlpha(onSurface, dark ? 0.08 : 0.05),
    flash: mixHex(primary, "#ffffff", dark ? 0.12 : 0.28),
    atmosphere: mixHex(primary, "#ffffff", dark ? 0.08 : 0.3),
    pinSeal: token("--error"),
    detailInk: mixHex(onSurface, outline, 0.35),
    detailLabel: onSurface,
  };
}

// --- country paths --------------------------------------------------------------

export interface CountryPath {
  code: string;
  path: Path2D;
  /** Base-canvas pixel bounding box of this country's geometry — lets a
   *  viewport-scoped repaint (detailPatch.ts) skip the fill/stroke calls for
   *  countries nowhere near the focused window instead of walking every
   *  ring in the ~10⁵-vertex atlas on every settle-triggered repaint. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Ring = number[][];

/**
 * Pre-builds one Path2D (+ pixel bbox) per country at the base canvas
 * resolution. Paths are built once per world load and reused across every
 * repaint (fog updates, theme flips, reveal overlays) — the 50m atlas has
 * ~10⁵ vertices, so path construction dominates a repaint if done naively
 * each time.
 */
export function buildCountryPaths(features: readonly CountryFeature[], width: number, height: number): CountryPath[] {
  const out: CountryPath[] = [];
  for (const f of features) {
    const path = new Path2D();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const addRing = (ring: Ring) => {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = latLngToEquirect(ring[i][1], ring[i][0], width, height);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      path.closePath();
    };
    if (f.geometry.type === "Polygon") {
      for (const ring of f.geometry.coordinates) addRing(ring);
    } else {
      for (const poly of f.geometry.coordinates) for (const ring of poly) addRing(ring);
    }
    out.push({ code: f.code, path, x0, y0, x1, y1 });
  }
  return out;
}

/**
 * Whether a country's bbox has any overlap with a paint viewport, both in
 * base-canvas pixel space. `margin` pads the test so a country whose fill
 * bbox sits just outside the viewport but whose STROKE (which extends
 * ~lineWidth/2 beyond the fill) would still poke in isn't wrongly culled.
 * Pure and exported so the ±baseW antimeridian-tiling case is unit-testable
 * without a canvas.
 */
export function bboxIntersectsViewport(bbox: { x0: number; y0: number; x1: number; y1: number }, viewport: PaintViewport, margin = 0): boolean {
  return (
    bbox.x0 - margin <= viewport.x1 &&
    bbox.x1 + margin >= viewport.x0 &&
    bbox.y0 - margin <= viewport.y1 &&
    bbox.y1 + margin >= viewport.y0
  );
}

// --- painting --------------------------------------------------------------------

// Deterministic PRNG so the parchment grain is identical across repaints —
// otherwise every fog update would make the whole globe subtly "shiver".
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatters `count` grain dots inside `rect` (base-canvas pixel space) —
 * NOT always the whole canvas: a viewport-scoped repaint passes just its own
 * small rect, so the density (count/area, chosen by the caller) reads the
 * same whether painting the whole atlas or a zoomed-in sliver of it, and no
 * cycles go to dots that would land outside the canvas anyway. `radiusScaleW`
 * is always the FULL base atlas width (not the rect's) so a dot's WORLD size
 * stays constant regardless of viewport — it naturally becomes more physical
 * pixels, and thus stays crisp, when a small rect is blown up to fill a
 * high-density patch canvas.
 */
function paintSpeckle(
  ctx: CanvasRenderingContext2D,
  rect: PaintViewport,
  radiusScaleW: number,
  color: string,
  count: number,
  seed: number,
): void {
  const rand = mulberry32(seed);
  const rw = rect.x1 - rect.x0;
  const rh = rect.y1 - rect.y0;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rect.x0 + rand() * rw;
    const y = rect.y0 + rand() * rh;
    const r = (0.4 + rand() * 1.1) * (radiusScaleW / 4096);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintGraticule(ctx: CanvasRenderingContext2D, w: number, h: number, palette: GlobePalette): void {
  const k = w / 4096;
  ctx.save();
  ctx.strokeStyle = palette.graticule;
  ctx.lineWidth = 1.4 * k;
  ctx.setLineDash([10 * k, 16 * k]);
  ctx.beginPath();
  for (let lng = -150; lng <= 150; lng += 30) {
    const [x] = latLngToEquirect(0, lng, w, h);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = latLngToEquirect(lat, 0, w, h);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A base-canvas pixel rect this paint call should fill the CURRENT ctx.canvas
 * with — i.e. "zoom into" this rect and blow it up to the canvas's full
 * physical size. Defaults to the whole atlas (an identity zoom), which is
 * what every existing call site wants. detailPatch.ts passes a small rect to
 * repaint just the camera's focused window at a much higher pixel density,
 * reusing this exact painter (same palette, same Path2D paths) so the patch
 * is indistinguishable from the base atlas except for sharpness.
 */
export interface PaintViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Full base repaint: ocean → grain → graticule → fog countries → visited
 * countries (on top, so their gold rims sit above fogged neighbours). Called
 * only when the world/visited set/theme changes — the caller uploads the
 * result once via texture.needsUpdate.
 */
export function paintGlobeBase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  paths: readonly CountryPath[],
  visited: ReadonlySet<string>,
  palette: GlobePalette,
  viewport: PaintViewport = { x0: 0, y0: 0, x1: w, y1: h },
): void {
  const k = w / 4096;
  const scaleX = ctx.canvas.width / (viewport.x1 - viewport.x0);
  const scaleY = ctx.canvas.height / (viewport.y1 - viewport.y0);
  ctx.setTransform(scaleX, 0, 0, scaleY, -viewport.x0 * scaleX, -viewport.y0 * scaleY);
  // Generous pad around the viewport for the bbox cull below: strokes and
  // the visited pass's shadowBlur both bleed a few world-pixels past a
  // country's exact fill bbox, and a wrongly-culled near-edge country would
  // show as a sliver missing its border right at the patch's seam.
  const cullMargin = 24 * k;

  const sea = ctx.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, palette.oceanPole);
  sea.addColorStop(0.3, palette.oceanMid);
  sea.addColorStop(0.5, palette.oceanCore);
  sea.addColorStop(0.7, palette.oceanMid);
  sea.addColorStop(1, palette.oceanPole);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, w, h);

  // Speckle is sampled WITHIN the viewport (not the whole atlas) at a count
  // derived from the viewport's own area — a windowed repaint (detailPatch.ts)
  // then gets the same apparent grain density as the full atlas instead of a
  // sparse handful of dots diluted across a world it isn't drawing. Clipped
  // to the valid [0,w]x[0,h] domain first: an antimeridian-straddling patch's
  // viewport can run outside that range (detailPatch's ±baseW tiling), and
  // sampling there would generate dots that land in the NEIGHBOURING dx
  // pass's rightful slice of the canvas instead of this pass's own — a
  // country's pre-built bbox never has this problem (it's always within the
  // valid domain already), only fresh random coordinates can wander outside it.
  const clipped = {
    x0: Math.max(viewport.x0, 0),
    x1: Math.min(viewport.x1, w),
    y0: Math.max(viewport.y0, 0),
    y1: Math.min(viewport.y1, h),
  };
  const clippedArea = Math.max(0, clipped.x1 - clipped.x0) * Math.max(0, clipped.y1 - clipped.y0);
  paintSpeckle(ctx, clipped, w, palette.speckle, Math.round(clippedArea / 4500), 7);
  paintGraticule(ctx, w, h, palette);

  ctx.lineJoin = "round";

  // Fog pass — the unexplored world, muted ink-parchment with fine borders.
  ctx.fillStyle = palette.fogFill;
  ctx.strokeStyle = palette.fogStroke;
  ctx.lineWidth = 1.6 * k;
  for (const country of paths) {
    if (visited.has(country.code)) continue;
    if (!bboxIntersectsViewport(country, viewport, cullMargin)) continue;
    ctx.fill(country.path, "evenodd");
    ctx.stroke(country.path);
  }

  // Visited pass — warm north→south gradient plus a soft gold-washed rim.
  const land = ctx.createLinearGradient(0, 0, 0, h);
  land.addColorStop(0.12, palette.landNorth);
  land.addColorStop(0.5, palette.landMid);
  land.addColorStop(0.88, palette.landSouth);
  ctx.save();
  ctx.fillStyle = land;
  ctx.strokeStyle = palette.landStroke;
  ctx.lineWidth = 3.4 * k;
  ctx.shadowColor = palette.landGlow;
  ctx.shadowBlur = 14 * k;
  for (const country of paths) {
    if (!visited.has(country.code)) continue;
    if (!bboxIntersectsViewport(country, viewport, cullMargin)) continue;
    ctx.fill(country.path, "evenodd");
    ctx.stroke(country.path);
  }
  ctx.restore();

  // A final whisper of grain over land and sea alike, unifying the page.
  paintSpeckle(ctx, clipped, w, palette.speckle, Math.round(clippedArea / 14000), 23);
}

/**
 * Paints ONLY the freshly-unlocked countries as a bright flash onto a
 * transparent overlay canvas (mapped on a slightly larger sphere). The scene
 * animates the overlay material's opacity 0→1→0 — one texture upload per
 * reveal instead of one per frame, which matters at atlas resolutions.
 * The overlay canvas may be smaller than the base; the transform rescales.
 */
export function paintRevealOverlay(
  ctx: CanvasRenderingContext2D,
  baseW: number,
  baseH: number,
  paths: readonly CountryPath[],
  codes: readonly string[],
  palette: GlobePalette,
): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(width / baseW, 0, 0, height / baseH, 0, 0);
  const wanted = new Set(codes);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.fillStyle = palette.flash;
  ctx.strokeStyle = palette.flash;
  ctx.lineWidth = 5 * (baseW / 4096);
  ctx.shadowColor = palette.flash;
  ctx.shadowBlur = 30 * (baseW / 4096);
  for (const { code, path } of paths) {
    if (!code || !wanted.has(code)) continue;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();
}

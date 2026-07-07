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
  "--primary": "#5746a8",
  "--primary-container": "#e5deff",
  "--tertiary-container": "#ffd9e8",
  "--on-surface": "#362f28",
  "--error": "#ba1a1a",
};
const DARK_FALLBACK: Record<string, string> = {
  "--surface-dim": "#0e0e13",
  "--surface-container-low": "#18181f",
  "--outline": "#55525f",
  "--outline-variant": "#34323e",
  "--primary": "#c8bfff",
  "--primary-container": "#46379a",
  "--tertiary-container": "#653152",
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
}

type Ring = number[][];

/**
 * Pre-builds one Path2D per country at the base canvas resolution. Paths are
 * built once per world load and reused across every repaint (fog updates,
 * theme flips, reveal overlays) — the 50m atlas has ~10⁵ vertices, so path
 * construction dominates a repaint if done naively each time.
 */
export function buildCountryPaths(features: readonly CountryFeature[], width: number, height: number): CountryPath[] {
  const out: CountryPath[] = [];
  for (const f of features) {
    const path = new Path2D();
    const addRing = (ring: Ring) => {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = latLngToEquirect(ring[i][1], ring[i][0], width, height);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
    };
    if (f.geometry.type === "Polygon") {
      for (const ring of f.geometry.coordinates) addRing(ring);
    } else {
      for (const poly of f.geometry.coordinates) for (const ring of poly) addRing(ring);
    }
    out.push({ code: f.code, path });
  }
  return out;
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

function paintSpeckle(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, seed: number): void {
  const rand = mulberry32(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = (0.4 + rand() * 1.1) * (w / 4096);
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
): void {
  const k = w / 4096;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const sea = ctx.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, palette.oceanPole);
  sea.addColorStop(0.3, palette.oceanMid);
  sea.addColorStop(0.5, palette.oceanCore);
  sea.addColorStop(0.7, palette.oceanMid);
  sea.addColorStop(1, palette.oceanPole);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, w, h);

  paintSpeckle(ctx, w, h, palette.speckle, Math.round((w * h) / 4500), 7);
  paintGraticule(ctx, w, h, palette);

  ctx.lineJoin = "round";

  // Fog pass — the unexplored world, muted ink-parchment with fine borders.
  ctx.fillStyle = palette.fogFill;
  ctx.strokeStyle = palette.fogStroke;
  ctx.lineWidth = 1.6 * k;
  for (const { code, path } of paths) {
    if (visited.has(code)) continue;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
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
  for (const { code, path } of paths) {
    if (!visited.has(code)) continue;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();

  // A final whisper of grain over land and sea alike, unifying the page.
  paintSpeckle(ctx, w, h, palette.speckle, Math.round((w * h) / 14000), 23);
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

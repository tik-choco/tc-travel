// Generic sub-national geometry for the world-wide drill-down — the pattern
// japanGeo.ts established, generalized to any country: lazy per-country
// GeoJSON loading, an area-accurate local projection (the same cos(mid-lat)
// correction, so a country's subdivisions keep their true proportions),
// point-in-polygon visit resolution, and a layout builder with optional
// insets for far-flung territories (US Alaska/Hawaii the way the Japan map
// insets Okinawa). Extends the projection with an antimeridian wrap so
// dateline-straddling regions (Alaska's Aleutians) don't smear across the
// whole frame.
//
// Map data © Natural Earth, public domain — vendored per country as
// <cc>.geojson with { code, name, name_local } props by
// scripts/fetch-subnational.mjs. Deliberately geometry-only (no hooks, no
// storage) so the whole module stays unit-testable — see
// __tests__/subnational.test.ts.
import type { MultiPolygon, Polygon } from "geojson";
import { pointInGeometry } from "../../../lib/geo";

export interface Subdivision {
  /** ISO 3166-2, e.g. "US-CA" */
  code: string;
  /** English name, e.g. "California" — the display fallback everywhere */
  name: string;
  /** Local-script name where Natural Earth has one (may be "") */
  name_local: string;
  geometry: Polygon | MultiPolygon;
}

export interface GeoPointLike {
  lat: number;
  lng: number;
}

// --- loading (lazy, cached) --------------------------------------------------

// Every vendored country file, as lazy `?raw` loaders (same chunking win as
// japanGeo's dynamic import): each geojson lands in its own chunk, fetched
// only when its country's drill-down actually opens. The glob also doubles as
// the availability check — a country whose fetch never ran simply isn't here,
// and the rest of the system compiles and runs without it.
const GEO_SOURCES = import.meta.glob("./*.geojson", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** Country codes (ISO 3166-1 alpha-2, lowercase) with vendored geometry. */
export const AVAILABLE_GEO_CODES: ReadonlySet<string> = new Set(
  Object.keys(GEO_SOURCES)
    .map((p) => /\.\/([a-z]{2})\.geojson$/.exec(p)?.[1] ?? "")
    .filter(Boolean),
);

interface SubdivisionFeature {
  properties: { code: string; name: string; name_local: string };
  geometry: Polygon | MultiPolygon;
}

export function parseSubdivisions(raw: string): Subdivision[] {
  const collection = JSON.parse(raw) as { features: SubdivisionFeature[] };
  return collection.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
}

const countryCache = new Map<string, Promise<Subdivision[]>>();

/** Lazily loads a country's subdivisions, parsed once and cached module-side. */
export function loadCountry(countryCode: string): Promise<Subdivision[]> {
  const cc = countryCode.toLowerCase();
  let cached = countryCache.get(cc);
  if (!cached) {
    const loader = GEO_SOURCES[`./${cc}.geojson`];
    if (!loader) return Promise.reject(new Error(`tc-travel: no sub-national data vendored for "${cc}"`));
    cached = loader()
      .then((raw) => parseSubdivisions(raw))
      .catch((err) => {
        countryCache.delete(cc); // allow a later retry once back online
        throw err;
      });
    countryCache.set(cc, cached);
  }
  return cached;
}

// --- bounds ------------------------------------------------------------------

export interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

type Ring = number[][];

function visitRings(geometry: Polygon | MultiPolygon, visit: (ring: Ring) => void): void {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) visit(ring);
  } else {
    for (const poly of geometry.coordinates) for (const ring of poly) visit(ring);
  }
}

/** lng shifted into [0, 360) — the coordinate space used when a fit has to
 *  cross the antimeridian (Alaska's Aleutian tail sits at +172..180 while the
 *  mainland sits at -180..-129). */
function wrapLng(lng: number): number {
  return lng < 0 ? lng + 360 : lng;
}

function boundsOfRings(rings: readonly Ring[], wrap: boolean): Bounds {
  const b: Bounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  for (const ring of rings) {
    for (const [rawLng, lat] of ring) {
      const lng = wrap ? wrapLng(rawLng) : rawLng;
      if (lng < b.minLng) b.minLng = lng;
      if (lng > b.maxLng) b.maxLng = lng;
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
    }
  }
  return b;
}

interface Fit {
  bounds: Bounds;
  /** true when the fit lives in wrapped-longitude space (crosses the antimeridian) */
  wrap: boolean;
}

/** Fits a set of rings, re-fitting in wrapped-longitude space when the plain
 *  fit spans more than half the world — the telltale of geometry that Natural
 *  Earth split at the dateline rather than land actually 180° wide. */
function fitRings(rings: readonly Ring[]): Fit {
  const plain = boundsOfRings(rings, false);
  if (plain.maxLng - plain.minLng <= 180) return { bounds: plain, wrap: false };
  return { bounds: boundsOfRings(rings, true), wrap: true };
}

export function geometryBounds(geometry: Polygon | MultiPolygon): Bounds {
  const rings: Ring[] = [];
  visitRings(geometry, (r) => rings.push(r));
  return boundsOfRings(rings, false);
}

/** Outer ring of the geometry's largest polygon — the "main landmass". */
function largestOuterRing(geometry: Polygon | MultiPolygon): Ring | null {
  if (geometry.type === "Polygon") return geometry.coordinates[0] ?? null;
  let best: Ring | null = null;
  for (const poly of geometry.coordinates) {
    if (poly[0] && (!best || poly[0].length > best.length)) best = poly[0];
  }
  return best;
}

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minLng: Math.min(a.minLng, b.minLng),
    minLat: Math.min(a.minLat, b.minLat),
    maxLng: Math.max(a.maxLng, b.maxLng),
    maxLat: Math.max(a.maxLat, b.maxLat),
  };
}

// Per-geometry bbox cache: the bbox pre-check rejects most (point, subdivision)
// pairs without ray-casting, and geometry objects are immutable once loaded.
const geometryBoundsCache = new WeakMap<Polygon | MultiPolygon, Bounds>();

function cachedBounds(geometry: Polygon | MultiPolygon): Bounds {
  let b = geometryBoundsCache.get(geometry);
  if (!b) {
    b = geometryBounds(geometry);
    geometryBoundsCache.set(geometry, b);
  }
  return b;
}

// --- visit resolution ----------------------------------------------------------

/** Slack around the country-level bbox pre-check, in degrees. */
const BBOX_SLACK = 0.5;

/** Resolves visited lat/lng points (pins, geo photos, geo diary entries) to
 *  the set of subdivision codes they fall inside. Derived on demand — the
 *  data model never stores subdivision codes, exactly like the Japan map. */
export function visitedSubdivisions(
  points: readonly GeoPointLike[],
  subs: readonly Subdivision[],
): Set<string> {
  const out = new Set<string>();
  if (points.length === 0 || subs.length === 0) return out;

  // Country-level fast reject: the union of all subdivision bboxes plus slack.
  let country: Bounds | null = null;
  for (const s of subs) {
    const b = cachedBounds(s.geometry);
    country = country ? mergeBounds(country, b) : { ...b };
  }
  if (!country) return out;

  for (const pt of points) {
    if (
      pt.lng < country.minLng - BBOX_SLACK ||
      pt.lng > country.maxLng + BBOX_SLACK ||
      pt.lat < country.minLat - BBOX_SLACK ||
      pt.lat > country.maxLat + BBOX_SLACK
    ) {
      continue;
    }
    for (const s of subs) {
      if (out.has(s.code)) continue; // already unlocked — skip the expensive test
      const b = cachedBounds(s.geometry);
      if (pt.lng < b.minLng || pt.lng > b.maxLng || pt.lat < b.minLat || pt.lat > b.maxLat) continue;
      if (pointInGeometry(pt.lng, pt.lat, s.geometry)) {
        out.add(s.code);
        break; // subdivisions don't overlap — first hit wins
      }
    }
    if (out.size === subs.length) break;
  }
  return out;
}

// --- local projection ----------------------------------------------------------

export interface LocalProjection {
  width: number;
  height: number;
  project(lng: number, lat: number): [number, number];
}

/** Linear (equirectangular) fit of a lng/lat box into a viewBox `width` units
 *  wide; height is derived. x is additionally scaled by cos(mid-lat) — the
 *  same correction japanGeo applies — so subdivisions keep their true
 *  proportions: a plain plate carrée stretches Korea ~25% and Alaska nearly
 *  2x sideways. `wrap` projects through [0, 360) longitude space for bounds
 *  produced by an antimeridian-crossing fit. */
export function createLocalProjection(
  bounds: Bounds,
  width: number,
  padding = 0,
  wrap = false,
): LocalProjection {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (bounds.maxLng - bounds.minLng) * kx || 1;
  const spanY = bounds.maxLat - bounds.minLat || 1;
  const scale = (width - padding * 2) / spanX;
  return {
    width,
    height: spanY * scale + padding * 2,
    project(lng: number, lat: number): [number, number] {
      const x = (wrap ? wrapLng(lng) : lng) - bounds.minLng;
      return [padding + x * kx * scale, padding + (bounds.maxLat - lat) * scale];
    },
  };
}

/** SVG path via the given local projection (japanGeo's geometryToLocalPath shape). */
export function geometryToLocalPath(geometry: Polygon | MultiPolygon, proj: LocalProjection): string {
  const parts: string[] = [];
  visitRings(geometry, (ring) => {
    let d = "";
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = proj.project(ring[i][0], ring[i][1]);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }
    parts.push(`${d}Z`);
  });
  return parts.join(" ");
}

/** Projected anchor for reveal flourishes: vertex mean of the largest outer
 *  ring, so the burst lands on the subdivision's main landmass rather than a
 *  bbox center that may sit in the sea between its islands. */
export function localAnchor(
  geometry: Polygon | MultiPolygon,
  proj: LocalProjection,
): [number, number] | null {
  const ring = largestOuterRing(geometry);
  if (!ring || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of ring) {
    const [x, y] = proj.project(lng, lat);
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

// --- layout ----------------------------------------------------------------------

export interface InsetSpec {
  /** subdivision code pulled out of the main frame into its own inset */
  code: string;
  /** inset frame width as a fraction of the layout width */
  widthRatio: number;
  /** curated fit override — e.g. Hawaii framed on its eight main islands so
   *  the far northwestern atolls don't drown the inset in open Pacific */
  frame?: Bounds;
}

/** Per-country inset conventions for far-flung subdivisions, keyed by
 *  lowercase ISO 3166-1 alpha-2 — the analog of the Japan map's Okinawa
 *  inset. Countries without an entry render everything in the main frame. */
export const COUNTRY_INSETS: Record<string, readonly InsetSpec[]> = {
  us: [
    { code: "US-AK", widthRatio: 0.3 },
    {
      code: "US-HI",
      widthRatio: 0.2,
      frame: { minLng: -160.7, maxLng: -154.7, minLat: 18.7, maxLat: 22.5 },
    },
    // ISO 3166-2:US includes Puerto Rico; in the main frame it would drag the
    // lower-48 fit deep into the Caribbean, so it insets like AK/HI.
    { code: "US-PR", widthRatio: 0.16 },
  ],
};

export function insetsFor(countryCode: string): readonly InsetSpec[] {
  return COUNTRY_INSETS[countryCode.toLowerCase()] ?? [];
}

export interface SubnationalLayout {
  width: number;
  height: number;
  paths: { code: string; d: string; anchor: [number, number] | null }[];
  /** inset frames in layout units, one per rendered inset (dashed border + clip) */
  insets: { code: string; x: number; y: number; w: number; h: number }[];
}

/** Projects a country's subdivisions into one viewBox: main landmasses
 *  full-frame (framed on each subdivision's largest ring, so remote islets
 *  don't drag the frame into open ocean), with inset subdivisions re-projected
 *  into a row of frames below the main map — a spot guaranteed land-free, no
 *  matter the country's shape. Pure function of its inputs — memoize the
 *  result; geometry is immutable once loaded. */
export function buildLayout(
  subs: readonly Subdivision[],
  width = 720,
  insetSpecs: readonly InsetSpec[] = [],
): SubnationalLayout {
  const pad = width * 0.03;
  if (subs.length === 0) return { width, height: width * 0.6, paths: [], insets: [] };

  const byCode = new Map(subs.map((s) => [s.code, s]));
  const applicable = insetSpecs.filter((spec) => byCode.has(spec.code));
  const insetCodes = new Set(applicable.map((spec) => spec.code));

  // --- main frame ---
  const mainRings: Ring[] = [];
  for (const s of subs) {
    if (insetCodes.has(s.code)) continue;
    const ring = largestOuterRing(s.geometry);
    if (ring) mainRings.push(ring);
  }
  if (mainRings.length === 0) {
    // pathological input (every subdivision inset) — fall back to full extent
    for (const s of subs) visitRings(s.geometry, (r) => mainRings.push(r));
  }
  const mainFit = fitRings(mainRings);
  const proj = createLocalProjection(mainFit.bounds, width, pad, mainFit.wrap);

  const paths: SubnationalLayout["paths"] = [];
  const insets: SubnationalLayout["insets"] = [];
  for (const s of subs) {
    if (insetCodes.has(s.code)) continue;
    paths.push({
      code: s.code,
      d: geometryToLocalPath(s.geometry, proj),
      anchor: localAnchor(s.geometry, proj),
    });
  }

  // --- inset row, below the main frame ---
  let x = pad;
  const rowY = proj.height + pad * 0.5;
  let rowH = 0;
  for (const spec of applicable) {
    const s = byCode.get(spec.code);
    if (!s) continue;
    const fit: Fit = spec.frame
      ? { bounds: spec.frame, wrap: false }
      : (() => {
          const rings: Ring[] = [];
          visitRings(s.geometry, (r) => rings.push(r));
          return fitRings(rings);
        })();
    const insetProj = createLocalProjection(fit.bounds, width * spec.widthRatio, pad * 0.5, fit.wrap);
    const offX = x;
    const offY = rowY;
    const shifted: LocalProjection = {
      width: insetProj.width,
      height: insetProj.height,
      project(lng, lat) {
        const [px, py] = insetProj.project(lng, lat);
        return [px + offX, py + offY];
      },
    };
    paths.push({
      code: s.code,
      d: geometryToLocalPath(s.geometry, shifted),
      anchor: localAnchor(s.geometry, shifted),
    });
    insets.push({ code: s.code, x: offX, y: offY, w: insetProj.width, h: insetProj.height });
    x += insetProj.width + pad;
    rowH = Math.max(rowH, insetProj.height);
  }

  const height = applicable.length > 0 ? rowY + rowH + pad * 0.5 : proj.height;
  return { width, height, paths, insets };
}

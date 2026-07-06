// Japan prefecture geometry for the drill-down map: lazy-loaded GeoJSON, a
// local-fit equirectangular projection (the world map's project() would render
// Japan a few pixels wide), point-in-polygon visit resolution, and the shared
// map layout (main view + Okinawa inset) used by both JapanMap and BragCard.
//
// Map data © Natural Earth, public domain — 47 prefectures incl. islands,
// vendored as japanPrefectures.geojson with { code, name, name_ja } props.
import type { MultiPolygon, Polygon } from "geojson";
import { useEffect, useMemo, useState } from "preact/hooks";
import { pointInGeometry } from "../../lib/geo";
import { useJourney } from "../../lib/personal";

export interface Prefecture {
  /** ISO 3166-2, e.g. "JP-13" */
  code: string;
  /** English name, e.g. "Tokyo" — display fallback for every language but ja */
  name: string;
  /** e.g. "東京都" */
  name_ja: string;
  geometry: Polygon | MultiPolygon;
}

export const OKINAWA_CODE = "JP-47";

// --- loading (lazy, cached) --------------------------------------------------

interface PrefectureFeature {
  properties: { code: string; name: string; name_ja: string };
  geometry: Polygon | MultiPolygon;
}

function parsePrefectures(raw: string): Prefecture[] {
  const collection = JSON.parse(raw) as { features: PrefectureFeature[] };
  return collection.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
}

let cachedPrefectures: Promise<Prefecture[]> | null = null;

/** Lazy `?raw` dynamic import (same pattern as geo.ts's loadWorldDetailed):
 *  the ~300KB geojson lands in its own chunk, loaded only when a traveller
 *  actually has a Japan visit, parsed once and cached module-side. */
export function loadJapanPrefectures(): Promise<Prefecture[]> {
  if (!cachedPrefectures) {
    cachedPrefectures = import("./japanPrefectures.geojson?raw")
      .then((mod) => parsePrefectures(mod.default))
      .catch((err) => {
        cachedPrefectures = null; // allow a later retry once back online
        throw err;
      });
  }
  return cachedPrefectures;
}

// --- visit resolution --------------------------------------------------------

export interface GeoPointLike {
  lat: number;
  lng: number;
}

/** Everything the dataset can contain, with a little slack — a fast reject
 *  before any per-prefecture work. */
const JAPAN_BBOX = { minLng: 122.5, maxLng: 154.5, minLat: 23.8, maxLat: 46.0 };

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

function boundsOfRings(rings: Ring[]): Bounds {
  const b: Bounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < b.minLng) b.minLng = lng;
      if (lng > b.maxLng) b.maxLng = lng;
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
    }
  }
  return b;
}

export function geometryBounds(geometry: Polygon | MultiPolygon): Bounds {
  const rings: Ring[] = [];
  visitRings(geometry, (r) => rings.push(r));
  return boundsOfRings(rings);
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

export function largestRingBounds(geometry: Polygon | MultiPolygon): Bounds {
  const ring = largestOuterRing(geometry);
  return boundsOfRings(ring ? [ring] : []);
}

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minLng: Math.min(a.minLng, b.minLng),
    minLat: Math.min(a.minLat, b.minLat),
    maxLng: Math.max(a.maxLng, b.maxLng),
    maxLat: Math.max(a.maxLat, b.maxLat),
  };
}

// Per-geometry bbox cache: the bbox pre-check rejects most (point, prefecture)
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

/** Resolves visited lat/lng points (pins, geo photos, geo diary entries) to
 *  the set of prefecture codes they fall inside. Derived on demand — the data
 *  model never stores prefecture codes. */
export function visitedPrefectures(
  points: readonly GeoPointLike[],
  prefs: readonly Prefecture[],
): Set<string> {
  const out = new Set<string>();
  for (const pt of points) {
    if (
      pt.lng < JAPAN_BBOX.minLng ||
      pt.lng > JAPAN_BBOX.maxLng ||
      pt.lat < JAPAN_BBOX.minLat ||
      pt.lat > JAPAN_BBOX.maxLat
    ) {
      continue;
    }
    for (const pref of prefs) {
      if (out.has(pref.code)) continue; // already unlocked — skip the expensive test
      const b = cachedBounds(pref.geometry);
      if (pt.lng < b.minLng || pt.lng > b.maxLng || pt.lat < b.minLat || pt.lat > b.maxLat) continue;
      if (pointInGeometry(pt.lng, pt.lat, pref.geometry)) {
        out.add(pref.code);
        break; // prefectures don't overlap — first hit wins
      }
    }
    if (out.size === prefs.length) break;
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
 *  wide; height is derived. x is additionally scaled by cos(mid-lat) so Japan
 *  keeps its true proportions — a plain plate carrée stretches ~22% sideways
 *  at 36°N. Still a straight-line mapping, which is fine at country scale. */
export function createProjection(bounds: Bounds, width: number, padding = 0): LocalProjection {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (bounds.maxLng - bounds.minLng) * kx || 1;
  const spanY = bounds.maxLat - bounds.minLat || 1;
  const scale = (width - padding * 2) / spanX;
  return {
    width,
    height: spanY * scale + padding * 2,
    project(lng: number, lat: number): [number, number] {
      return [padding + (lng - bounds.minLng) * kx * scale, padding + (bounds.maxLat - lat) * scale];
    },
  };
}

/** SVG path via the given local projection — geoMath.geometryToPath's shape,
 *  minus its hardwired whole-world project(). */
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
 *  ring, so the burst lands on the prefecture's main landmass, not on a bbox
 *  center that may sit in the sea between its islands. */
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

// --- shared map layout ----------------------------------------------------------

/** The main view frames each prefecture's largest landmass instead of its full
 *  extent — otherwise Tokyo's Ogasawara islets (out to 154°E) would drag half
 *  the frame into open Pacific. Extended south so Kagoshima's inhabited island
 *  chain (Tanegashima → Yakushima → Amami → Yoron, down to ~27°N) stays
 *  on-frame; only far-oceanic specks get clipped by the viewBox. */
const MAIN_MIN_LAT = 26.9;

/** Okinawa inset size relative to the layout width, placed top-left — the
 *  Sea of Japan corner, guaranteed land-free. Standard Japan-map convention. */
const INSET_WIDTH_RATIO = 0.34;

export interface JapanLayout {
  width: number;
  height: number;
  paths: { code: string; d: string; anchor: [number, number] | null }[];
  /** frame of the Okinawa inset, in layout units */
  inset: { x: number; y: number; w: number; h: number };
}

/** Projects all 47 prefectures into one viewBox: main islands full-frame,
 *  Okinawa re-projected into an inset. Pure function of (prefs, width) —
 *  memoize the result; geometry is immutable once loaded. */
export function buildJapanLayout(prefs: readonly Prefecture[], width = 720): JapanLayout {
  const pad = width * 0.03;
  let mainBounds: Bounds | null = null;
  for (const p of prefs) {
    if (p.code === OKINAWA_CODE) continue;
    const b = largestRingBounds(p.geometry);
    mainBounds = mainBounds ? mergeBounds(mainBounds, b) : b;
  }
  if (!mainBounds) mainBounds = { ...JAPAN_BBOX };
  mainBounds = { ...mainBounds, minLat: Math.min(mainBounds.minLat, MAIN_MIN_LAT) };
  const proj = createProjection(mainBounds, width, pad);

  const paths: JapanLayout["paths"] = [];
  let inset = { x: pad, y: pad, w: 0, h: 0 };
  for (const p of prefs) {
    if (p.code === OKINAWA_CODE) {
      // Okinawa gets its own fitted projection, offset into the inset frame.
      const okiProj = createProjection(geometryBounds(p.geometry), width * INSET_WIDTH_RATIO, pad * 0.5);
      const offX = pad;
      const offY = pad;
      const shifted: LocalProjection = {
        width: okiProj.width,
        height: okiProj.height,
        project(lng, lat) {
          const [x, y] = okiProj.project(lng, lat);
          return [x + offX, y + offY];
        },
      };
      paths.push({ code: p.code, d: geometryToLocalPath(p.geometry, shifted), anchor: localAnchor(p.geometry, shifted) });
      inset = { x: offX, y: offY, w: okiProj.width, h: okiProj.height };
    } else {
      paths.push({ code: p.code, d: geometryToLocalPath(p.geometry, proj), anchor: localAnchor(p.geometry, proj) });
    }
  }
  return { width, height: proj.height, paths, inset };
}

// --- hook: journey → visited prefecture set ----------------------------------

/** Derives the visited-prefecture set from the local journey mirror (pins +
 *  geo photos + geo diary). `active` gates the lazy geojson load so the world
 *  map can mount this unconditionally and only pay once Japan is actually
 *  visited at country level. */
export function useJapanCollection(active: boolean): {
  prefs: Prefecture[] | null;
  visited: Set<string>;
} {
  const journey = useJourney();
  const [prefs, setPrefs] = useState<Prefecture[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadJapanPrefectures()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((err) => console.warn("tc-travel: japan prefecture data unavailable", err));
    return () => {
      cancelled = true;
    };
  }, [active]);

  // useJourney() re-reads localStorage each render, so its arrays are always
  // fresh identities — key the expensive point-in-polygon pass on a cheap
  // content fingerprint instead.
  const points: GeoPointLike[] = [];
  for (const p of journey.pins) points.push(p);
  for (const p of journey.photos) if (p.geo) points.push(p.geo);
  for (const d of journey.diary) if (d.geo) points.push(d.geo);
  const pointsKey = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");

  const visited = useMemo(
    () => (prefs ? visitedPrefectures(points, prefs) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pointsKey stands in for `points`
    [prefs, pointsKey],
  );
  return { prefs, visited };
}

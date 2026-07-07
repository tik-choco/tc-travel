// Municipality (市区町村, admin-2) geometry for the collection tier below
// prefectures: lazy loading of the vendored geoBoundaries data, visit
// resolution with a prefecture pre-filter (1742 polygons brute-forced per
// point would hurt — each feature carries a pre-stamped `pref` so a point
// only ray-casts against its own prefecture's municipalities), grouping and
// completion helpers, and pin-time `municipalityOf` lookup.
//
// Map data © OpenStreetMap contributors, via geoBoundaries JPN ADM2
// (CC BY-SA 2.0) — vendored as jp.geojson with { code, name, pref } props by
// scripts/fetch-municipalities.mjs; see docs/DATA_LICENSES.md for the
// attribution requirements. Names are ROMAJI for now (the source has no
// Japanese names); a future JIS-code join can add name_ja.
//
// Deliberately geometry-only (no hooks, no storage) so the whole module is
// unit-testable — see __tests__/municipal.test.ts.
import type { MultiPolygon, Polygon } from "geojson";
import { pointInGeometry } from "../../../lib/geo";
import { geometryBounds, mergeBounds, type Bounds } from "../subnational/subnationalGeo";

export interface Municipality {
  /** geoBoundaries shapeID — stable, opaque identifier */
  code: string;
  /** Romaji name, e.g. "Shibuya" (no name_ja in the source yet) */
  name: string;
  /** ISO 3166-2 prefecture code ("JP-01".."JP-47"), stamped at vendor time */
  pref: string;
  geometry: Polygon | MultiPolygon;
}

/** Minimal prefecture shape the pre-filter needs — japanGeo's Prefecture satisfies it. */
export interface PrefectureLike {
  code: string;
  geometry: Polygon | MultiPolygon;
}

export interface GeoPointLike {
  lat: number;
  lng: number;
}

// --- loading (lazy, cached, availability-gated) --------------------------------

// Lazy `?raw` loaders for every vendored municipality file (jp.geojson today;
// the glob leaves room for other countries' admin-2 later). Doubles as the
// availability check, so the tier compiles and runs whether or not
// `npm run fetch-municipalities` ever succeeded.
const GEO_SOURCES = import.meta.glob("./*.geojson", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** Country codes (ISO 3166-1 alpha-2, lowercase) with vendored municipality data. */
export const MUNICIPAL_COUNTRY_CODES: readonly string[] = Object.keys(GEO_SOURCES)
  .map((p) => /\.\/([a-z]{2})\.geojson$/.exec(p)?.[1] ?? "")
  .filter(Boolean)
  .sort();

export function hasMunicipalData(countryCode: string): boolean {
  return MUNICIPAL_COUNTRY_CODES.includes(countryCode.toLowerCase());
}

interface MunicipalityFeature {
  properties: { code: string; name: string; pref: string };
  geometry: Polygon | MultiPolygon;
}

export function parseMunicipalities(raw: string): Municipality[] {
  const collection = JSON.parse(raw) as { features: MunicipalityFeature[] };
  return collection.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
}

const cache = new Map<string, Promise<Municipality[]>>();

/** Lazily loads a country's municipalities (~2.2 MB chunk for jp), parsed
 *  once and cached module-side. The public loader API for the globe LOD pass
 *  as well — it gets the same parsed, immutable array. */
export function loadMunicipalities(countryCode = "jp"): Promise<Municipality[]> {
  const cc = countryCode.toLowerCase();
  let cached = cache.get(cc);
  if (!cached) {
    const loader = GEO_SOURCES[`./${cc}.geojson`];
    if (!loader) return Promise.reject(new Error(`tc-travel: no municipality data vendored for "${cc}"`));
    cached = loader()
      .then((raw) => parseMunicipalities(raw))
      .catch((err) => {
        cache.delete(cc); // allow a later retry once back online
        throw err;
      });
    cache.set(cc, cached);
  }
  return cached;
}

// --- bbox cache (same fast-reject trick as the prefecture/subnational tiers) ---

const boundsCache = new WeakMap<Polygon | MultiPolygon, Bounds>();

function cachedBounds(geometry: Polygon | MultiPolygon): Bounds {
  let b = boundsCache.get(geometry);
  if (!b) {
    b = geometryBounds(geometry);
    boundsCache.set(geometry, b);
  }
  return b;
}

function inBounds(pt: GeoPointLike, b: Bounds, slack = 0): boolean {
  return (
    pt.lng >= b.minLng - slack &&
    pt.lng <= b.maxLng + slack &&
    pt.lat >= b.minLat - slack &&
    pt.lat <= b.maxLat + slack
  );
}

// --- grouping -------------------------------------------------------------------

// Municipality arrays are parsed once and immutable, so grouping caches per array.
const groupCache = new WeakMap<readonly Municipality[], Map<string, Municipality[]>>();

/** Municipalities keyed by prefecture code — built once per loaded dataset. */
export function groupByPref(munis: readonly Municipality[]): Map<string, Municipality[]> {
  let grouped = groupCache.get(munis);
  if (!grouped) {
    grouped = new Map();
    for (const m of munis) {
      const list = grouped.get(m.pref);
      if (list) list.push(m);
      else grouped.set(m.pref, [m]);
    }
    groupCache.set(munis, grouped);
  }
  return grouped;
}

export function municipalitiesOfPref(munis: readonly Municipality[], pref: string): Municipality[] {
  return groupByPref(munis).get(pref) ?? [];
}

// --- visit resolution -------------------------------------------------------------

/** Resolves visited lat/lng points to the set of municipality codes they fall
 *  inside. Derived on demand — the data model never stores municipality codes
 *  (same rule as the prefecture tier). Each point resolves its prefecture
 *  ONCE against `prefs`, then only that prefecture's municipalities are
 *  bbox-checked and ray-cast; points whose prefecture doesn't resolve (pins
 *  right on the NE-vs-OSM coastline mismatch) fall back to a bbox-gated scan
 *  of everything, which is rare enough not to matter. */
export function visitedMunicipalities(
  points: readonly GeoPointLike[],
  munis: readonly Municipality[],
  prefs: readonly PrefectureLike[],
): Set<string> {
  const out = new Set<string>();
  if (points.length === 0 || munis.length === 0) return out;

  // country-level fast reject: union of municipality bboxes plus slack
  let country: Bounds | null = null;
  for (const m of munis) {
    const b = cachedBounds(m.geometry);
    country = country ? mergeBounds(country, b) : { ...b };
  }
  if (!country) return out;

  const grouped = groupByPref(munis);
  for (const pt of points) {
    if (!inBounds(pt, country, 0.5)) continue;

    let prefCode = "";
    for (const p of prefs) {
      if (!inBounds(pt, cachedBounds(p.geometry))) continue;
      if (pointInGeometry(pt.lng, pt.lat, p.geometry)) {
        prefCode = p.code;
        break;
      }
    }
    const candidates = prefCode ? (grouped.get(prefCode) ?? []) : munis;

    for (const m of candidates) {
      if (out.has(m.code)) continue; // already unlocked — skip the expensive test
      if (!inBounds(pt, cachedBounds(m.geometry))) continue;
      if (pointInGeometry(pt.lng, pt.lat, m.geometry)) {
        out.add(m.code);
        break; // municipalities don't overlap — first hit wins
      }
    }
    if (out.size === munis.length) break;
  }
  return out;
}

/** Pin-time lookup: the municipality code a single point falls inside, or
 *  null (open sea / no data vendored / no match). Loads the data lazily on
 *  first use, so callers can fire-and-forget it from capture paths. */
export async function municipalityOf(lat: number, lng: number): Promise<string | null> {
  if (!hasMunicipalData("jp")) return null;
  const munis = await loadMunicipalities("jp");
  const pt = { lat, lng };
  for (const m of munis) {
    if (!inBounds(pt, cachedBounds(m.geometry))) continue;
    if (pointInGeometry(lng, lat, m.geometry)) return m.code;
  }
  return null;
}

// --- completion stats ---------------------------------------------------------------

export interface MunicipalStats {
  /** municipalities visited (only counts codes present in the dataset) */
  count: number;
  total: number;
  /** rounded percentage for display */
  pct: number;
  /** unrounded percentage, for progress bars where 1/1742 must still move the needle */
  exactPct: number;
}

function statsOf(visited: ReadonlySet<string>, munis: readonly Municipality[]): MunicipalStats {
  let count = 0;
  for (const m of munis) if (visited.has(m.code)) count++;
  const total = munis.length;
  const exactPct = total > 0 ? (count / total) * 100 : 0;
  return { count, total, pct: Math.round(exactPct), exactPct };
}

/** Overall completion — N / 1742 across all of Japan. */
export function municipalCompletion(
  visited: ReadonlySet<string>,
  munis: readonly Municipality[],
): MunicipalStats {
  return statsOf(visited, munis);
}

/** One prefecture's completion — the "東京都 12/62" number. */
export function prefMunicipalStats(
  visited: ReadonlySet<string>,
  munis: readonly Municipality[],
  pref: string,
): MunicipalStats {
  return statsOf(visited, municipalitiesOfPref(munis, pref));
}

// --- prefecture stamping (vendor-time logic, exported for tests) --------------------

type Ring = number[][];

function largestOuterRing(geometry: Polygon | MultiPolygon): Ring | null {
  if (geometry.type === "Polygon") return geometry.coordinates[0] ?? null;
  let best: Ring | null = null;
  for (const poly of geometry.coordinates) {
    if (poly[0] && (!best || poly[0].length > best.length)) best = poly[0];
  }
  return best;
}

/** The prefecture a municipality geometry belongs to — the exact tiering
 *  scripts/fetch-municipalities.mjs uses to stamp `pref` at vendor time
 *  (mirrored here because a plain-node .mjs script can't import this module;
 *  the unit tests keep the two in step):
 *   1. largest-ring vertex mean (the usual case),
 *   2. blends between that mean and sampled ring vertices — pulls the test
 *      point toward the interior when the mean lands in a bay,
 *   3. nearest prefecture by bbox-center distance, so something always stamps. */
export function prefOfGeometry(
  geometry: Polygon | MultiPolygon,
  prefs: readonly PrefectureLike[],
): string {
  const ring = largestOuterRing(geometry);
  if (!ring || ring.length === 0) return "";

  let cx = 0;
  let cy = 0;
  for (const [lng, lat] of ring) {
    cx += lng;
    cy += lat;
  }
  cx /= ring.length;
  cy /= ring.length;

  const prefAt = (lng: number, lat: number): string => {
    for (const p of prefs) {
      if (!inBounds({ lat, lng }, cachedBounds(p.geometry))) continue;
      if (pointInGeometry(lng, lat, p.geometry)) return p.code;
    }
    return "";
  };

  let code = prefAt(cx, cy);
  if (code) return code;

  for (const t of [0.5, 0.9]) {
    const step = Math.max(1, Math.floor(ring.length / 8));
    for (let i = 0; i < ring.length; i += step) {
      const [vx, vy] = ring[i];
      code = prefAt(cx + (vx - cx) * t, cy + (vy - cy) * t);
      if (code) return code;
    }
  }

  let bestCode = "";
  let bestDist = Infinity;
  for (const p of prefs) {
    const b = cachedBounds(p.geometry);
    const px = (b.minLng + b.maxLng) / 2;
    const py = (b.minLat + b.maxLat) / 2;
    const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d < bestDist) {
      bestDist = d;
      bestCode = p.code;
    }
  }
  return bestCode;
}

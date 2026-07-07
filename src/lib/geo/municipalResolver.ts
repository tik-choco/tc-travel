// Dynamic worldwide admin-2 (municipality) resolver.
//
// The Japan municipality tier (components/map/municipal/municipalGeo.ts) vendors
// its boundaries into the bundle. That doesn't scale to every country, so this
// module resolves a lat/lng to its municipality DYNAMICALLY: it fetches a
// country's admin-2 boundaries from geoBoundaries the first time they're needed,
// caches them in IndexedDB so the country works offline afterward, and remembers
// each point's resolution in a small persistent index so recomputing exploration
// stats is cheap and offline-safe.
//
// Design rules that callers (explorationStats.ts, the globe) can rely on:
//   - NOTHING here ever throws to a caller. Offline, no ADM2 layer for a country,
//     a blocked fetch — all degrade to `null`. The UI shows what resolved and
//     stays country-level for the rest.
//   - One fetch per country at a time (in-flight de-dupe), and a country resolves
//     at most once per session (its result — array OR null — is memoized).
//   - Resolution order: vendored (jp, the fast path) → IndexedDB cache → network.
//
// Attribution: dynamically fetched admin-2 is geoBoundaries/OSM CC BY-SA — see
// docs/DATA_LICENSES.md.
import type { MultiPolygon, Polygon } from "geojson";
import { lookupCountry, pointInGeometry } from "../geo";
import { alpha2ToAlpha3 } from "./iso3";
import {
  hasMunicipalData,
  loadMunicipalities,
} from "../../components/map/municipal/municipalGeo";

/** A country's admin-2 unit, normalized across vendored / cached / fetched sources. */
export interface Admin2Feature {
  /** stable opaque id — geoBoundaries shapeID, or the vendored municipality code */
  code: string;
  /** display name (romaji / English / local script, whatever the source carries) */
  name: string;
  geometry: Polygon | MultiPolygon;
}

/** The outcome of resolving a single point to its municipality. */
export interface ResolvedMunicipality {
  /** ISO 3166-1 alpha-2 lowercase */
  countryCode: string;
  /** Admin2Feature.code within that country */
  code: string;
  name: string;
}

// --- point key (rounded, ~110 m) ---------------------------------------------

/** The persistent index key for a point — rounded to 3 decimals so two pins a
 *  few metres apart share a resolution and the index stays small. */
export function pointKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

// --- bbox pre-filter (same fast-reject trick as the vendored tiers) ----------

interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const bboxCache = new WeakMap<Polygon | MultiPolygon, BBox>();

function bboxOf(geometry: Polygon | MultiPolygon): BBox {
  let b = bboxCache.get(geometry);
  if (b) return b;
  b = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < b.minLng) b.minLng = lng;
      if (lng > b.maxLng) b.maxLng = lng;
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
    }
  }
  bboxCache.set(geometry, b);
  return b;
}

/** The admin-2 feature a point falls inside, or null — bbox-gated point-in-polygon. */
export function featureAt(
  features: readonly Admin2Feature[],
  lat: number,
  lng: number,
): Admin2Feature | null {
  for (const f of features) {
    const b = bboxOf(f.geometry);
    if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
    if (pointInGeometry(lng, lat, f.geometry)) return f;
  }
  return null;
}

// --- geometry slimming for fetched data --------------------------------------
// geoBoundaries' "simplified" files are still denser than a point-in-polygon
// membership test needs; rounding to 3 decimals (~110 m) shrinks what we hold in
// IndexedDB with no effect on which municipality a pin lands in.

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function slimRing(ring: number[][]): number[][] | null {
  const out: number[][] = [];
  for (const pt of ring) {
    const p = [round3(pt[0]), round3(pt[1])];
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  if (out.length >= 3) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  }
  return out.length >= 4 ? out : null;
}

function slimPolygon(coords: number[][][]): number[][][] | null {
  const outer = slimRing(coords[0] ?? []);
  if (!outer) return null;
  const rings = [outer];
  for (const hole of coords.slice(1)) {
    const r = slimRing(hole); // holes kept: enclave units must not double-match
    if (r) rings.push(r);
  }
  return rings;
}

function slimGeometry(geometry: unknown): Polygon | MultiPolygon | null {
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g?.type === "Polygon") {
    const coords = slimPolygon(g.coordinates as number[][][]);
    return coords ? { type: "Polygon", coordinates: coords } : null;
  }
  if (g?.type === "MultiPolygon") {
    const polys: number[][][][] = [];
    for (const poly of g.coordinates as number[][][][]) {
      const p = slimPolygon(poly);
      if (p) polys.push(p);
    }
    if (polys.length === 0) return null;
    return polys.length === 1
      ? { type: "Polygon", coordinates: polys[0] }
      : { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

interface GeoBoundariesFeature {
  properties?: { shapeID?: unknown; shapeName?: unknown; shapeGroup?: unknown };
  geometry?: unknown;
}

/** Strips a fetched geoBoundaries ADM2 FeatureCollection to Admin2Feature[].
 *  Exported so the fetch/parse contract can be unit-tested without the network. */
export function parseGeoBoundariesAdm2(raw: string, iso3: string): Admin2Feature[] {
  const collection = JSON.parse(raw) as { features?: GeoBoundariesFeature[] };
  const features: Admin2Feature[] = [];
  const seen = new Set<string>();
  for (const f of collection.features ?? []) {
    const props = f.properties ?? {};
    if (props.shapeGroup && String(props.shapeGroup).toUpperCase() !== iso3) continue;
    const geometry = slimGeometry(f.geometry);
    if (!geometry) continue;
    let code = String(props.shapeID ?? "");
    if (!code) code = `${iso3}-ADM2-${features.length + 1}`;
    while (seen.has(code)) code = `${code}x`;
    seen.add(code);
    features.push({ code, name: String(props.shapeName ?? code), geometry });
  }
  return features;
}

// MUST hit media.githubusercontent.com directly, NOT github.com/.../raw/...:
// these simplified files are Git LFS objects, and github.com's raw redirect's
// first hop (a 302 on github.com itself) comes back with an EMPTY
// access-control-allow-origin header — browsers block the fetch right there,
// so every dynamic country silently resolved to null. (curl follows the
// redirect chain without enforcing CORS, which is why this looked fine from a
// terminal.) raw.githubusercontent.com is ALSO unusable for the same LFS
// reason: it serves the pointer text file, not the actual geometry.
// media.githubusercontent.com is the LFS media host and returns the real
// content directly with `access-control-allow-origin: *`, verified for CHN.
const GEOBOUNDARIES_URL = (iso3: string): string =>
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/${iso3}/ADM2/geoBoundaries-${iso3}-ADM2_simplified.geojson`;

// --- IndexedDB cache for fetched admin-2 boundaries --------------------------
// A dedicated DB, separate from the VRM (tc-travel-vrm) and photo
// (tc-travel-photos) stores so the three never collide.

const DB_NAME = "tc-travel-admin2";
const STORE_NAME = "boundaries";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open admin2 IndexedDB"));
  });
}

async function idbReadAdmin2(cc: string): Promise<Admin2Feature[] | null> {
  const db = await openDb();
  try {
    return await new Promise<Admin2Feature[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(cc);
      req.onsuccess = () => resolve((req.result as Admin2Feature[] | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read admin2 cache"));
    });
  } finally {
    db.close();
  }
}

async function idbWriteAdmin2(cc: string, features: Admin2Feature[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(features, cc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write admin2 cache"));
    });
  } finally {
    db.close();
  }
}

// --- pluggable backends (real by default; swapped in tests) ------------------
// ensureCountryAdmin2's three sources live behind this seam so its ordering /
// de-dupe logic can be unit-tested with fetch and IndexedDB mocked, while
// production wires up the real vendored loader, IDB cache, and network fetch.

export interface ResolverBackends {
  /** vendored, in-bundle boundaries (jp today); null if none for this country */
  loadVendored(cc: string): Promise<Admin2Feature[] | null>;
  /** previously-fetched boundaries from IndexedDB; null if not cached / no IDB */
  readCache(cc: string): Promise<Admin2Feature[] | null>;
  /** persist fetched boundaries to IndexedDB (best-effort) */
  writeCache(cc: string, features: Admin2Feature[]): Promise<void>;
  /** fetch + parse boundaries from geoBoundaries; null on any failure */
  fetchRemote(cc: string): Promise<Admin2Feature[] | null>;
}

const defaultBackends: ResolverBackends = {
  async loadVendored(cc) {
    if (!hasMunicipalData(cc)) return null;
    try {
      const munis = await loadMunicipalities(cc);
      return munis.map((m) => ({ code: m.code, name: m.name, geometry: m.geometry }));
    } catch {
      return null;
    }
  },
  async readCache(cc) {
    try {
      return await idbReadAdmin2(cc);
    } catch {
      return null;
    }
  },
  async writeCache(cc, features) {
    try {
      await idbWriteAdmin2(cc, features);
    } catch {
      // cache miss on write only costs a future refetch — never surfaced
    }
  },
  async fetchRemote(cc) {
    const iso3 = alpha2ToAlpha3(cc);
    if (!iso3) return null;
    try {
      const res = await fetch(GEOBOUNDARIES_URL(iso3), { redirect: "follow" });
      if (!res.ok) return null;
      const features = parseGeoBoundariesAdm2(await res.text(), iso3);
      return features.length > 0 ? features : null;
    } catch {
      return null;
    }
  },
};

let backends: ResolverBackends = defaultBackends;

// --- per-country boundary resolution (in-memory memoized) --------------------

const countryCache = new Map<string, Promise<Admin2Feature[] | null>>();

/** Resolves a country's admin-2 boundaries, trying vendored → IndexedDB cache →
 *  network in order and caching the network result to IndexedDB. Memoized per
 *  country for the session (the resolved value, array OR null, is reused), and
 *  in-flight de-duped (concurrent callers share one fetch). Returns null when a
 *  country has no ADM2 layer or the data is unreachable — never throws. */
export function ensureCountryAdmin2(cc: string): Promise<Admin2Feature[] | null> {
  const code = cc.toLowerCase();
  let cached = countryCache.get(code);
  if (cached) return cached;
  cached = (async () => {
    const vendored = await backends.loadVendored(code);
    if (vendored && vendored.length > 0) return vendored;
    const fromCache = await backends.readCache(code);
    if (fromCache && fromCache.length > 0) return fromCache;
    const fetched = await backends.fetchRemote(code);
    if (fetched && fetched.length > 0) {
      await backends.writeCache(code, fetched);
      return fetched;
    }
    return null;
  })().catch(() => null);
  countryCache.set(code, cached);
  return cached;
}

// --- persistent resolved-index (localStorage, warmed into memory) ------------
// Small, sync-readable, and offline-safe: once a point resolves, its answer is
// remembered so exploration stats recompute without any async work on later
// sessions. localStorage (not IDB) so `resolvedForPoint` can be synchronous.

const RESOLVED_KEY = "tc-travel:admin2:resolved";

const resolvedIndex = new Map<string, ResolvedMunicipality>();
let warmed = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function ensureWarm(): void {
  if (warmed) return;
  warmed = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(RESOLVED_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, ResolvedMunicipality>;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.countryCode === "string" && typeof v.code === "string") {
        resolvedIndex.set(k, v);
      }
    }
  } catch {
    // corrupt / unavailable storage — start from an empty index
  }
}

function persistIndex(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RESOLVED_KEY, JSON.stringify(Object.fromEntries(resolvedIndex)));
  } catch {
    // storage full / private mode — the in-memory index still works this session
  }
}

function recordResolution(lat: number, lng: number, resolved: ResolvedMunicipality): void {
  ensureWarm();
  resolvedIndex.set(pointKey(lat, lng), resolved);
  persistIndex();
  notify();
}

/** The remembered resolution for a point, synchronously from the loaded index —
 *  null if it hasn't been resolved yet. Cheap enough to call per-point every
 *  render; warms the index from localStorage on first use. */
export function resolvedForPoint(lat: number, lng: number): ResolvedMunicipality | null {
  ensureWarm();
  return resolvedIndex.get(pointKey(lat, lng)) ?? null;
}

/** Loads the persistent resolved-index into memory (idempotent). Await it in an
 *  effect before reading `resolvedForPoint` if you need the offline answers on
 *  first paint; `resolvedForPoint` also warms lazily. */
export function warmResolvedIndex(): Promise<void> {
  ensureWarm();
  return Promise.resolve();
}

/** Subscribe to resolved-index changes (a new point resolved). Returns an
 *  unsubscribe fn. Lets reactive consumers re-read `resolvedForPoint` as
 *  background resolutions land. */
export function subscribeResolved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- the single-point resolver -----------------------------------------------

/** Best-effort resolution of a point to its municipality: country lookup →
 *  ensure that country's admin-2 boundaries → bbox-gated point-in-polygon. On
 *  success the answer is recorded in the persistent index (so `resolvedForPoint`
 *  returns it thereafter and subscribers are notified). Returns null for ocean
 *  points, countries with no ADM2 data, or anything unreachable — never throws. */
export async function resolveMunicipality(
  lat: number,
  lng: number,
): Promise<ResolvedMunicipality | null> {
  const existing = resolvedForPoint(lat, lng);
  if (existing) return existing;
  try {
    const cc = await lookupCountry(lat, lng);
    if (!cc) return null;
    const features = await ensureCountryAdmin2(cc);
    if (!features) return null;
    const hit = featureAt(features, lat, lng);
    if (!hit) return null;
    const resolved: ResolvedMunicipality = { countryCode: cc, code: hit.code, name: hit.name };
    recordResolution(lat, lng, resolved);
    return resolved;
  } catch {
    return null;
  }
}

// --- test-only seams ----------------------------------------------------------
// Underscore-prefixed and never used by production code. They let tests inject
// fake vendored/cache/fetch backends to assert resolution order, and reset the
// module's in-memory + persistent state between cases.

/** @internal test-only: override some or all resolver backends. */
export function __setResolverBackends(partial: Partial<ResolverBackends>): void {
  backends = { ...backends, ...partial };
}

/** @internal test-only: reset backends, in-memory caches, and the resolved index. */
export function __resetResolverForTest(): void {
  backends = defaultBackends;
  countryCache.clear();
  resolvedIndex.clear();
  warmed = false;
  listeners.clear();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(RESOLVED_KEY);
  } catch {
    /* ignore */
  }
}

// Dynamic worldwide admin-1 (state/province/prefecture) resolver.
//
// jp/us/kr already carry their admin-1 boundaries in the bundle: Japan via its
// bespoke japanGeo.ts, US/KR via subnationalGeo.ts's vendored Natural Earth
// files. That doesn't scale to every country, so this module resolves the
// REST dynamically — the same pattern municipalResolver.ts uses for admin-2:
// fetch a country's admin-1 boundaries from geoBoundaries the first time
// they're needed, and cache them in IndexedDB so the country works offline
// afterward.
//
// Design rules mirror municipalResolver.ts exactly, so callers (SubnationalMap,
// the globe's admin-1 LOD tier) can rely on them:
//   - NOTHING here ever throws to a caller. Offline, no ADM1 layer for a
//     country, a blocked fetch — all degrade to `null`. The UI shows a
//     graceful "no data" state and stays country-level.
//   - One fetch per country at a time (in-flight de-dupe), and a country
//     resolves at most once per session (its result — array OR null — is
//     memoized).
//   - Resolution order: vendored (us/kr's Natural Earth files, the fast path)
//     → IndexedDB cache → network. Japan is NOT handled here — it keeps its
//     own bespoke loader (japanGeo.ts) and never reaches this module.
//
// Attribution: dynamically fetched admin-1 is geoBoundaries/OSM CC BY-SA — see
// docs/DATA_LICENSES.md. The vendored us/kr fast path stays Natural Earth
// public domain, unaffected by this module.
import type { MultiPolygon, Polygon } from "geojson";
import { alpha2ToAlpha3 } from "./iso3";
import { AVAILABLE_GEO_CODES, loadCountry } from "../../components/map/subnational/subnationalGeo";

/** A country's admin-1 unit, normalized across vendored / cached / fetched sources. */
export interface Admin1Feature {
  /** stable opaque id — ISO 3166-2 when the source carries one (vendored data,
   *  and geoBoundaries' shapeISO where present), else a geoBoundaries shapeID */
  code: string;
  /** display name (English / local script, whatever the source carries) */
  name: string;
  /** local-script name — only vendored sources (us/kr) carry one; "" otherwise */
  nameLocal: string;
  geometry: Polygon | MultiPolygon;
}

// --- geometry slimming for fetched data --------------------------------------
// Mirrors municipalResolver.ts's slimming rules: geoBoundaries' "simplified"
// files are still denser than the drill-down's point-in-polygon test needs;
// rounding to 3 decimals (~110 m) shrinks what's held in IndexedDB with no
// visible effect on a state/province-sized boundary.

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
  properties?: { shapeID?: unknown; shapeName?: unknown; shapeGroup?: unknown; shapeISO?: unknown };
  geometry?: unknown;
}

/** Strips a fetched geoBoundaries ADM1 FeatureCollection to Admin1Feature[].
 *  Prefers `shapeISO` for the code, but ONLY when it actually looks like a
 *  subdivision code (contains "-", e.g. "FR-IDF") — countries with no ISO
 *  3166-2 coverage (e.g. China) carry the bare country code ("CHN") on every
 *  single feature, which would collide and dedupe into order-dependent
 *  "CHN"/"CHNx"/"CHNxx" codes. Falls back to shapeID (geoBoundaries' own
 *  globally-unique, stable identifier) in that case, then a synthesized code
 *  as a last resort. Exported so the fetch/parse contract can be unit-tested
 *  without the network. */
export function parseGeoBoundariesAdm1(raw: string, iso3: string): Admin1Feature[] {
  const collection = JSON.parse(raw) as { features?: GeoBoundariesFeature[] };
  const features: Admin1Feature[] = [];
  const seen = new Set<string>();
  for (const f of collection.features ?? []) {
    const props = f.properties ?? {};
    if (props.shapeGroup && String(props.shapeGroup).toUpperCase() !== iso3) continue;
    const geometry = slimGeometry(f.geometry);
    if (!geometry) continue;
    let code = String(props.shapeISO ?? "").trim();
    if (!code.includes("-")) code = ""; // a bare country code, not a real subdivision code
    if (!code) code = String(props.shapeID ?? "");
    if (!code) code = `${iso3}-ADM1-${features.length + 1}`;
    while (seen.has(code)) code = `${code}x`;
    seen.add(code);
    features.push({ code, name: String(props.shapeName ?? code), nameLocal: "", geometry });
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
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1_simplified.geojson`;

// --- IndexedDB cache for fetched admin-1 boundaries --------------------------
// A dedicated DB, separate from admin-2's (tc-travel-admin2) and the VRM/photo
// stores so none of them collide.

const DB_NAME = "tc-travel-admin1";
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
    req.onerror = () => reject(req.error ?? new Error("Failed to open admin1 IndexedDB"));
  });
}

async function idbReadAdmin1(cc: string): Promise<Admin1Feature[] | null> {
  const db = await openDb();
  try {
    return await new Promise<Admin1Feature[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(cc);
      req.onsuccess = () => resolve((req.result as Admin1Feature[] | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read admin1 cache"));
    });
  } finally {
    db.close();
  }
}

async function idbWriteAdmin1(cc: string, features: Admin1Feature[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(features, cc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write admin1 cache"));
    });
  } finally {
    db.close();
  }
}

// --- pluggable backends (real by default; swapped in tests) ------------------
// ensureCountryAdmin1's three sources live behind this seam so its ordering /
// de-dupe logic can be unit-tested with fetch and IndexedDB mocked, while
// production wires up the real vendored loader, IDB cache, and network fetch.

export interface Admin1ResolverBackends {
  /** vendored, in-bundle boundaries (us/kr today); null if none for this country */
  loadVendored(cc: string): Promise<Admin1Feature[] | null>;
  /** previously-fetched boundaries from IndexedDB; null if not cached / no IDB */
  readCache(cc: string): Promise<Admin1Feature[] | null>;
  /** persist fetched boundaries to IndexedDB (best-effort) */
  writeCache(cc: string, features: Admin1Feature[]): Promise<void>;
  /** fetch + parse boundaries from geoBoundaries; null on any failure */
  fetchRemote(cc: string): Promise<Admin1Feature[] | null>;
}

const defaultBackends: Admin1ResolverBackends = {
  async loadVendored(cc) {
    if (!AVAILABLE_GEO_CODES.has(cc)) return null;
    try {
      const subs = await loadCountry(cc);
      return subs.map((s) => ({ code: s.code, name: s.name, nameLocal: s.name_local, geometry: s.geometry }));
    } catch {
      return null;
    }
  },
  async readCache(cc) {
    try {
      return await idbReadAdmin1(cc);
    } catch {
      return null;
    }
  },
  async writeCache(cc, features) {
    try {
      await idbWriteAdmin1(cc, features);
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
      const features = parseGeoBoundariesAdm1(await res.text(), iso3);
      return features.length > 0 ? features : null;
    } catch {
      return null;
    }
  },
};

let backends: Admin1ResolverBackends = defaultBackends;

// --- per-country boundary resolution (in-memory memoized) --------------------

const countryCache = new Map<string, Promise<Admin1Feature[] | null>>();

/** Resolves a country's admin-1 boundaries, trying vendored → IndexedDB cache →
 *  network in order and caching the network result to IndexedDB. Memoized per
 *  country for the session (the resolved value, array OR null, is reused), and
 *  in-flight de-duped (concurrent callers share one fetch). Returns null when a
 *  country has no ADM1 layer or the data is unreachable — never throws. */
export function ensureCountryAdmin1(cc: string): Promise<Admin1Feature[] | null> {
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

/** True when a country's fast, synchronous (vendored) path is available —
 *  informational only (e.g. for a "how did this resolve" credit line); every
 *  country is still worth calling ensureCountryAdmin1 for regardless. */
export function hasVendoredAdmin1(cc: string): boolean {
  return AVAILABLE_GEO_CODES.has(cc.toLowerCase());
}

// --- test-only seams ----------------------------------------------------------
// Underscore-prefixed and never used by production code. They let tests inject
// fake vendored/cache/fetch backends to assert resolution order, and reset the
// module's in-memory state between cases.

/** @internal test-only: override some or all resolver backends. */
export function __setAdmin1ResolverBackends(partial: Partial<Admin1ResolverBackends>): void {
  backends = { ...backends, ...partial };
}

/** @internal test-only: reset backends and the in-memory country cache. */
export function __resetAdmin1ResolverForTest(): void {
  backends = defaultBackends;
  countryCache.clear();
}

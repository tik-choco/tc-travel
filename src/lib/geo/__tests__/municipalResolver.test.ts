import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetResolverForTest,
  __setResolverBackends,
  ensureCountryAdmin2,
  featureAt,
  parseGeoBoundariesAdm2,
  pointKey,
  resolveMunicipality,
  resolvedForPoint,
  warmResolvedIndex,
  type Admin2Feature,
} from "../municipalResolver";

// Node's vitest runner has no localStorage; a Map-backed stand-in exercises the
// persistent resolved-index code path (warm + round-trip) deterministically.
class FakeStorage {
  store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

const RESOLVED_KEY = "tc-travel:admin2:resolved";
const ls = (): FakeStorage => globalThis.localStorage as unknown as FakeStorage;

/** [lng0,lat0]–[lng1,lat1] axis-aligned box as a Polygon. */
const box = (lng0: number, lat0: number, lng1: number, lat1: number): Admin2Feature["geometry"] => ({
  type: "Polygon",
  coordinates: [
    [
      [lng0, lat0],
      [lng1, lat0],
      [lng1, lat1],
      [lng0, lat1],
      [lng0, lat0],
    ],
  ],
});

const feat = (code: string, geometry: Admin2Feature["geometry"]): Admin2Feature => ({
  code,
  name: code,
  geometry,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", new FakeStorage());
  __resetResolverForTest();
});
afterEach(() => {
  __resetResolverForTest();
  vi.unstubAllGlobals();
});

describe("pointKey", () => {
  it("rounds to 3 decimals so nearby points share a key", () => {
    expect(pointKey(35.12345, 139.9)).toBe("35.123,139.900");
    expect(pointKey(35.1231, 139.9004)).toBe(pointKey(35.1234, 139.8996));
  });
});

describe("featureAt", () => {
  const feats = [feat("A", box(0, 0, 10, 10)), feat("B", box(10, 0, 20, 10))];
  it("returns the containing feature (bbox-gated point-in-polygon)", () => {
    expect(featureAt(feats, 5, 5)?.code).toBe("A"); // (lat 5, lng 5)
    expect(featureAt(feats, 5, 15)?.code).toBe("B"); // (lat 5, lng 15)
  });
  it("returns null when outside every feature", () => {
    expect(featureAt(feats, 50, 50)).toBeNull();
  });
});

describe("parseGeoBoundariesAdm2", () => {
  it("strips props to {code,name}, filters by shapeGroup, drops degenerate geometry", () => {
    const raw = JSON.stringify({
      features: [
        { properties: { shapeID: "S1", shapeName: "Alpha", shapeGroup: "FRA" }, geometry: box(0, 0, 1, 1) },
        // wrong country group — dropped
        { properties: { shapeID: "S2", shapeName: "Beta", shapeGroup: "DEU" }, geometry: box(1, 1, 2, 2) },
        // no geometry — dropped
        { properties: { shapeID: "S3", shapeName: "Gamma", shapeGroup: "FRA" } },
      ],
    });
    const feats = parseGeoBoundariesAdm2(raw, "FRA");
    expect(feats.map((f) => f.code)).toEqual(["S1"]);
    expect(feats[0].name).toBe("Alpha");
    expect(feats[0].geometry.type).toBe("Polygon");
  });

  it("synthesizes codes and de-dupes collisions", () => {
    const raw = JSON.stringify({
      features: [
        { properties: { shapeName: "NoId" }, geometry: box(0, 0, 1, 1) },
        { properties: { shapeID: "DUP" }, geometry: box(0, 0, 1, 1) },
        { properties: { shapeID: "DUP" }, geometry: box(0, 0, 1, 1) },
      ],
    });
    const feats = parseGeoBoundariesAdm2(raw, "XYZ");
    expect(new Set(feats.map((f) => f.code)).size).toBe(feats.length); // all unique
    expect(feats[0].code).toBe("XYZ-ADM2-1");
  });
});

describe("ensureCountryAdmin2 resolution order", () => {
  it("returns vendored data without touching cache or network", async () => {
    const readCache = vi.fn(async () => null);
    const fetchRemote = vi.fn(async () => null);
    const vendored = [feat("V", box(0, 0, 1, 1))];
    __setResolverBackends({ loadVendored: async () => vendored, readCache, fetchRemote });
    expect(await ensureCountryAdmin2("jp")).toBe(vendored);
    expect(readCache).not.toHaveBeenCalled();
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it("falls back to the IndexedDB cache before the network", async () => {
    const cached = [feat("C", box(0, 0, 1, 1))];
    const fetchRemote = vi.fn(async () => null);
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => cached,
      fetchRemote,
    });
    expect(await ensureCountryAdmin2("fr")).toBe(cached);
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it("fetches from the network and writes through to the cache", async () => {
    const fetched = [feat("F", box(0, 0, 1, 1))];
    const writeCache = vi.fn(async () => {});
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => fetched,
      writeCache,
    });
    expect(await ensureCountryAdmin2("DE")).toBe(fetched); // uppercase input normalized
    expect(writeCache).toHaveBeenCalledWith("de", fetched);
  });

  it("returns null when every source misses (offline / no ADM2 layer)", async () => {
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => null,
    });
    expect(await ensureCountryAdmin2("br")).toBeNull();
  });

  it("de-dupes concurrent fetches and memoizes the result for the session", async () => {
    const fetchRemote = vi.fn(async () => [feat("X", box(0, 0, 1, 1))]);
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote,
    });
    const [a, b] = await Promise.all([ensureCountryAdmin2("it"), ensureCountryAdmin2("it")]);
    expect(a).toBe(b);
    await ensureCountryAdmin2("it"); // still memoized
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it("never throws even if a backend rejects", async () => {
    __setResolverBackends({
      loadVendored: async () => {
        throw new Error("boom");
      },
    });
    await expect(ensureCountryAdmin2("nz")).resolves.toBeNull();
  });
});

describe("resolveMunicipality + persistent resolved-index", () => {
  it("resolves via lookupCountry + boundaries and records the point", async () => {
    // Paris (48.8566, 2.3522) → fr; supply a polygon covering it.
    const paris = feat("FR-75", box(2.0, 48.5, 2.7, 49.0));
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => [paris],
      writeCache: async () => {},
    });
    const r = await resolveMunicipality(48.8566, 2.3522);
    expect(r).toEqual({ countryCode: "fr", code: "FR-75", name: "FR-75" });

    // recorded → the synchronous index lookup now returns it...
    expect(resolvedForPoint(48.8566, 2.3522)).toEqual(r);
    // ...and it's persisted to storage under the rounded key.
    const raw = ls().getItem(RESOLVED_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)[pointKey(48.8566, 2.3522)]).toEqual(r);
  });

  it("returns null for an ocean point with no country", async () => {
    expect(await resolveMunicipality(0, -140)).toBeNull();
  });

  it("returns null when the country has no resolvable boundaries", async () => {
    // Paris again, but the country resolves to no boundaries → country-level only.
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => null,
    });
    expect(await resolveMunicipality(48.8566, 2.3522)).toBeNull();
    expect(resolvedForPoint(48.8566, 2.3522)).toBeNull();
  });

  it("warms the resolved-index from storage on fresh module state", async () => {
    const key = pointKey(35.0, 135.0);
    const val = { countryCode: "jp", code: "M1", name: "Somewhere" };
    __resetResolverForTest(); // clears in-memory + storage
    ls().setItem(RESOLVED_KEY, JSON.stringify({ [key]: val }));
    await warmResolvedIndex();
    expect(resolvedForPoint(35.0, 135.0)).toEqual(val);
  });

  it("notifies subscribers when a point resolves", async () => {
    const paris = feat("FR-75", box(2.0, 48.5, 2.7, 49.0));
    __setResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => [paris],
      writeCache: async () => {},
    });
    const { subscribeResolved } = await import("../municipalResolver");
    const spy = vi.fn();
    const unsub = subscribeResolved(spy);
    await resolveMunicipality(48.8566, 2.3522);
    expect(spy).toHaveBeenCalled();
    unsub();
  });
});

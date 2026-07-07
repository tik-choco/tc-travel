import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAdmin1ResolverForTest,
  __setAdmin1ResolverBackends,
  ensureCountryAdmin1,
  hasVendoredAdmin1,
  parseGeoBoundariesAdm1,
  type Admin1Feature,
} from "../admin1Resolver";
import { AVAILABLE_GEO_CODES } from "../../../components/map/subnational/subnationalGeo";

/** [lng0,lat0]–[lng1,lat1] axis-aligned box as a Polygon. */
const box = (lng0: number, lat0: number, lng1: number, lat1: number): Admin1Feature["geometry"] => ({
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

const feat = (code: string, geometry: Admin1Feature["geometry"]): Admin1Feature => ({
  code,
  name: code,
  nameLocal: "",
  geometry,
});

beforeEach(() => {
  __resetAdmin1ResolverForTest();
});
afterEach(() => {
  __resetAdmin1ResolverForTest();
});

describe("parseGeoBoundariesAdm1", () => {
  it("prefers shapeISO for the code, filters by shapeGroup, drops degenerate geometry", () => {
    const raw = JSON.stringify({
      features: [
        {
          properties: { shapeISO: "FR-IDF", shapeID: "S1", shapeName: "Île-de-France", shapeGroup: "FRA" },
          geometry: box(2, 48, 3, 49),
        },
        // wrong country group — dropped
        { properties: { shapeID: "S2", shapeName: "Bavaria", shapeGroup: "DEU" }, geometry: box(10, 47, 13, 50) },
        // no geometry — dropped
        { properties: { shapeID: "S3", shapeName: "Ghost", shapeGroup: "FRA" } },
      ],
    });
    const feats = parseGeoBoundariesAdm1(raw, "FRA");
    expect(feats.map((f) => f.code)).toEqual(["FR-IDF"]);
    expect(feats[0].name).toBe("Île-de-France");
    expect(feats[0].nameLocal).toBe("");
    expect(feats[0].geometry.type).toBe("Polygon");
  });

  it("falls back to shapeID when shapeISO is absent, then synthesizes and de-dupes", () => {
    const raw = JSON.stringify({
      features: [
        { properties: { shapeID: "ID1", shapeName: "Alpha" }, geometry: box(0, 0, 1, 1) },
        { properties: { shapeName: "NoId" }, geometry: box(0, 0, 1, 1) },
        { properties: { shapeID: "DUP" }, geometry: box(0, 0, 1, 1) },
        { properties: { shapeID: "DUP" }, geometry: box(0, 0, 1, 1) },
      ],
    });
    const feats = parseGeoBoundariesAdm1(raw, "XYZ");
    expect(feats[0].code).toBe("ID1");
    expect(new Set(feats.map((f) => f.code)).size).toBe(feats.length); // all unique
    expect(feats.some((f) => f.code === "XYZ-ADM1-2")).toBe(true);
  });

  it("ignores a blank shapeISO string rather than treating it as a real code", () => {
    const raw = JSON.stringify({
      features: [{ properties: { shapeISO: "  ", shapeID: "S1" }, geometry: box(0, 0, 1, 1) }],
    });
    expect(parseGeoBoundariesAdm1(raw, "XYZ")[0].code).toBe("S1");
  });

  it("falls back to shapeID for countries with no ISO 3166-2 coverage (e.g. China)", () => {
    // geoBoundaries has no subdivision-level ISO code for CHN, so shapeISO is
    // the bare country code on EVERY feature — using it verbatim would collide
    // and dedupe into order-dependent "CHN"/"CHNx"/"CHNxx" codes instead of the
    // stable, globally-unique shapeID.
    const raw = JSON.stringify({
      features: [
        { properties: { shapeISO: "CHN", shapeID: "84617164B60228076660392", shapeName: "Beijing" }, geometry: box(116, 39, 117, 41) },
        { properties: { shapeISO: "CHN", shapeID: "84617164B94991351660393", shapeName: "Shanghai" }, geometry: box(121, 30, 122, 32) },
      ],
    });
    const feats = parseGeoBoundariesAdm1(raw, "CHN");
    expect(feats.map((f) => f.code)).toEqual(["84617164B60228076660392", "84617164B94991351660393"]);
  });
});

describe("ensureCountryAdmin1 resolution order", () => {
  it("returns vendored data without touching cache or network", async () => {
    const readCache = vi.fn(async () => null);
    const fetchRemote = vi.fn(async () => null);
    const vendored = [feat("US-CA", box(-125, 32, -114, 42))];
    __setAdmin1ResolverBackends({ loadVendored: async () => vendored, readCache, fetchRemote });
    expect(await ensureCountryAdmin1("us")).toBe(vendored);
    expect(readCache).not.toHaveBeenCalled();
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it("falls back to the IndexedDB cache before the network", async () => {
    const cached = [feat("FR-IDF", box(2, 48, 3, 49))];
    const fetchRemote = vi.fn(async () => null);
    __setAdmin1ResolverBackends({ loadVendored: async () => null, readCache: async () => cached, fetchRemote });
    expect(await ensureCountryAdmin1("fr")).toBe(cached);
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it("fetches from the network and writes through to the cache", async () => {
    const fetched = [feat("DE-BY", box(10, 47, 13, 50))];
    const writeCache = vi.fn(async () => {});
    __setAdmin1ResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => fetched,
      writeCache,
    });
    expect(await ensureCountryAdmin1("DE")).toBe(fetched); // uppercase input normalized
    expect(writeCache).toHaveBeenCalledWith("de", fetched);
  });

  it("returns null when every source misses (offline / no ADM1 layer)", async () => {
    __setAdmin1ResolverBackends({
      loadVendored: async () => null,
      readCache: async () => null,
      fetchRemote: async () => null,
    });
    expect(await ensureCountryAdmin1("aq")).toBeNull();
  });

  it("de-dupes concurrent fetches and memoizes the result for the session", async () => {
    const fetchRemote = vi.fn(async () => [feat("IT-62", box(12, 41, 13, 42))]);
    __setAdmin1ResolverBackends({ loadVendored: async () => null, readCache: async () => null, fetchRemote });
    const [a, b] = await Promise.all([ensureCountryAdmin1("it"), ensureCountryAdmin1("it")]);
    expect(a).toBe(b);
    await ensureCountryAdmin1("it"); // still memoized
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it("never throws even if a backend rejects", async () => {
    __setAdmin1ResolverBackends({
      loadVendored: async () => {
        throw new Error("boom");
      },
    });
    await expect(ensureCountryAdmin1("nz")).resolves.toBeNull();
  });
});

describe("hasVendoredAdmin1", () => {
  it("is case-insensitive and mirrors AVAILABLE_GEO_CODES", () => {
    // Self-skips gracefully if scripts/fetch-subnational.mjs never ran (offline
    // clone) — same convention as subnational.test.ts's vendored-data smoke tests.
    expect(hasVendoredAdmin1("US")).toBe(AVAILABLE_GEO_CODES.has("us"));
    expect(hasVendoredAdmin1("zz")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  AVAILABLE_GEO_CODES,
  buildLayout,
  createLocalProjection,
  insetsFor,
  loadCountry,
  parseSubdivisions,
  visitedSubdivisions,
} from "../subnationalGeo";
import { SUBNATIONAL_COUNTRY_CODES, SUBNATIONAL_REGISTRY, subnationalEntry } from "../registry";

// Two well-separated subdivisions: a plain square and a two-island group.
const FIXTURE = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { code: "T-A", name: "Alpha", name_local: "アルファ" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "T-B", name: "Beta", name_local: "" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [10, 10],
              [12, 10],
              [12, 12],
              [10, 12],
              [10, 10],
            ],
          ],
          [
            [
              [13, 10],
              [13.5, 10],
              [13.5, 10.5],
              [13, 10.5],
              [13, 10],
            ],
          ],
        ],
      },
    },
  ],
});

const subs = parseSubdivisions(FIXTURE);

describe("parseSubdivisions", () => {
  it("lifts properties and keeps geometry", () => {
    expect(subs.map((s) => s.code)).toEqual(["T-A", "T-B"]);
    expect(subs[0].name).toBe("Alpha");
    expect(subs[0].name_local).toBe("アルファ");
    expect(subs[1].name_local).toBe("");
    expect(subs[1].geometry.type).toBe("MultiPolygon");
  });
});

describe("visitedSubdivisions", () => {
  it("resolves a point inside a subdivision to its code", () => {
    expect(visitedSubdivisions([{ lat: 1, lng: 1 }], subs)).toEqual(new Set(["T-A"]));
  });

  it("resolves points in secondary islands of a MultiPolygon", () => {
    expect(visitedSubdivisions([{ lat: 10.25, lng: 13.25 }], subs)).toEqual(new Set(["T-B"]));
  });

  it("rejects points inside the country bbox but outside every subdivision", () => {
    expect(visitedSubdivisions([{ lat: 5, lng: 5 }], subs).size).toBe(0);
  });

  it("rejects points far outside the country bbox", () => {
    expect(visitedSubdivisions([{ lat: 50, lng: 50 }], subs).size).toBe(0);
  });

  it("accumulates codes across points and stays empty on empty input", () => {
    const visited = visitedSubdivisions(
      [
        { lat: 1, lng: 1 },
        { lat: 11, lng: 11 },
      ],
      subs,
    );
    expect(visited).toEqual(new Set(["T-A", "T-B"]));
    expect(visitedSubdivisions([], subs).size).toBe(0);
  });
});

describe("createLocalProjection", () => {
  it("keeps true proportions via the cos(mid-lat) correction", () => {
    // A 2°×2° box at 60°N: cos(60°) = 0.5, so it must project half as wide
    // as it is tall — a plain plate carrée would render it square.
    const proj = createLocalProjection({ minLng: 0, maxLng: 2, minLat: 59, maxLat: 61 }, 100, 0);
    expect(proj.height).toBeCloseTo(200, 0);
    expect(proj.project(0, 61)).toEqual([0, 0]); // top-left corner
    const [x, y] = proj.project(2, 59); // bottom-right corner
    expect(x).toBeCloseTo(100, 5);
    expect(y).toBeCloseTo(200, 5);
  });
});

describe("buildLayout", () => {
  it("produces a path and an anchor for every subdivision", () => {
    const layout = buildLayout(subs, 720);
    expect(layout.paths.map((p) => p.code).sort()).toEqual(["T-A", "T-B"]);
    for (const p of layout.paths) {
      expect(p.d.startsWith("M")).toBe(true);
      expect(p.d.endsWith("Z")).toBe(true);
      expect(p.d).not.toContain("NaN");
      expect(p.anchor).not.toBeNull();
    }
    expect(layout.width).toBe(720);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.insets).toEqual([]);
  });

  it("re-projects inset subdivisions into their frame below the main map", () => {
    const plain = buildLayout(subs, 720);
    const layout = buildLayout(subs, 720, [{ code: "T-B", widthRatio: 0.3 }]);
    expect(layout.insets).toHaveLength(1);
    const frame = layout.insets[0];
    expect(frame.code).toBe("T-B");
    // the inset row extends the layout below the main frame
    expect(layout.height).toBeGreaterThan(plain.height / 2);
    const inset = layout.paths.find((p) => p.code === "T-B");
    expect(inset?.anchor).not.toBeNull();
    const [ax, ay] = inset!.anchor!;
    expect(ax).toBeGreaterThanOrEqual(frame.x);
    expect(ax).toBeLessThanOrEqual(frame.x + frame.w);
    expect(ay).toBeGreaterThanOrEqual(frame.y);
    expect(ay).toBeLessThanOrEqual(frame.y + frame.h);
  });

  it("ignores inset specs whose subdivision is absent", () => {
    const layout = buildLayout(subs, 720, [{ code: "T-MISSING", widthRatio: 0.3 }]);
    expect(layout.insets).toEqual([]);
    expect(layout.paths).toHaveLength(2);
  });

  it("fits antimeridian-straddling countries without smearing the frame", () => {
    // Two subdivisions on either side of the dateline (Natural Earth splits
    // geometry there) — the fit must wrap to a ~4° span, not span the world.
    const dateline = parseSubdivisions(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { code: "T-W", name: "West of the line", name_local: "" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [178, 0],
                  [179.5, 0],
                  [179.5, 1],
                  [178, 1],
                  [178, 0],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: { code: "T-E", name: "East of the line", name_local: "" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-179.5, 0],
                  [-178, 0],
                  [-178, 1],
                  [-179.5, 1],
                  [-179.5, 0],
                ],
              ],
            },
          },
        ],
      }),
    );
    const layout = buildLayout(dateline, 720);
    // unwrapped, the ~358° pseudo-span would collapse height to ~45 units
    expect(layout.height).toBeGreaterThan(100);
    for (const p of layout.paths) {
      expect(p.d).not.toContain("NaN");
      expect(p.anchor![0]).toBeGreaterThanOrEqual(0);
      expect(p.anchor![0]).toBeLessThanOrEqual(720);
    }
  });
});

describe("registry", () => {
  it("routes Japan to the existing JapanMap", () => {
    const jp = subnationalEntry("jp");
    expect(jp?.kind).toBe("japan");
    expect(jp?.hasData).toBe(true);
    expect(subnationalEntry("JP")).toBe(jp); // case-insensitive lookup
  });

  it("registers the curated generic countries", () => {
    for (const code of ["us", "kr"]) {
      const entry = SUBNATIONAL_REGISTRY.get(code);
      expect(entry?.kind).toBe("generic");
      expect(entry?.displayNameKey).toBe(`map.sub.country.${code}`);
      // hasData mirrors whether the vendored geojson actually shipped
      expect(entry?.hasData).toBe(AVAILABLE_GEO_CODES.has(code));
    }
  });

  it("exposes exactly the openable codes to the world map", () => {
    expect(SUBNATIONAL_COUNTRY_CODES).toContain("jp");
    for (const entry of SUBNATIONAL_REGISTRY.values()) {
      expect(SUBNATIONAL_COUNTRY_CODES.includes(entry.code)).toBe(entry.hasData);
    }
  });

  it("keeps US inset conventions for the far-flung subdivisions", () => {
    const codes = insetsFor("us").map((s) => s.code);
    expect(codes).toContain("US-AK");
    expect(codes).toContain("US-HI");
    expect(insetsFor("kr")).toEqual([]);
  });
});

// Smoke tests against the vendored Natural Earth data — they self-skip when
// scripts/fetch-subnational.mjs hasn't run (offline clone), matching how the
// registry gates hasData on the files actually existing.
describe("vendored data", () => {
  it.skipIf(!AVAILABLE_GEO_CODES.has("kr"))("resolves Seoul into KR-11", async () => {
    const kr = await loadCountry("kr");
    expect(kr.length).toBe(17); // 17 first-level divisions
    const visited = visitedSubdivisions([{ lat: 37.5665, lng: 126.978 }], kr);
    expect(visited).toEqual(new Set(["KR-11"]));
    const layout = buildLayout(kr, 720, insetsFor("kr"));
    expect(layout.paths).toHaveLength(17);
    for (const p of layout.paths) expect(p.d).not.toContain("NaN");
  });

  it.skipIf(!AVAILABLE_GEO_CODES.has("us"))(
    "resolves US cities and lays out the AK/HI/PR insets",
    async () => {
      const us = await loadCountry("us");
      const visited = visitedSubdivisions(
        [
          { lat: 40.7128, lng: -74.006 }, // New York City
          { lat: 21.3069, lng: -157.8583 }, // Honolulu
          { lat: 61.2181, lng: -149.9003 }, // Anchorage
        ],
        us,
      );
      expect(visited).toEqual(new Set(["US-NY", "US-HI", "US-AK"]));

      const layout = buildLayout(us, 720, insetsFor("us"));
      expect(layout.paths).toHaveLength(us.length);
      expect(layout.insets.map((f) => f.code).sort()).toEqual(["US-AK", "US-HI", "US-PR"]);
      for (const p of layout.paths) expect(p.d).not.toContain("NaN");
      // Honolulu's burst anchor must land inside the Hawaii inset frame
      const hi = layout.insets.find((f) => f.code === "US-HI")!;
      const anchor = layout.paths.find((p) => p.code === "US-HI")!.anchor!;
      expect(anchor[0]).toBeGreaterThanOrEqual(hi.x);
      expect(anchor[0]).toBeLessThanOrEqual(hi.x + hi.w);
      expect(anchor[1]).toBeGreaterThanOrEqual(hi.y);
      expect(anchor[1]).toBeLessThanOrEqual(hi.y + hi.h);
      // and the whole layout must stay a sane portrait-ish aspect
      expect(layout.height).toBeGreaterThan(300);
      expect(layout.height).toBeLessThan(1200);
    },
  );
});

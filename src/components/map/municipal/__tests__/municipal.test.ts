import { describe, expect, it } from "vitest";
import {
  MUNICIPAL_COUNTRY_CODES,
  groupByPref,
  hasMunicipalData,
  loadMunicipalities,
  municipalCompletion,
  municipalitiesOfPref,
  municipalityOf,
  parseMunicipalities,
  prefMunicipalStats,
  prefOfGeometry,
  visitedMunicipalities,
  type PrefectureLike,
} from "../municipalGeo";

// Two square "prefectures" side by side, and municipalities within them.
const square = (x0: number, y0: number, x1: number, y1: number) =>
  ({
    type: "Polygon" as const,
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  });

const PREFS: PrefectureLike[] = [
  { code: "P-1", geometry: square(0, 0, 10, 10) },
  { code: "P-2", geometry: square(10, 0, 20, 10) },
];

const FIXTURE = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { code: "M-A", name: "Alpha", pref: "P-1" }, geometry: square(0, 0, 2, 2) },
    { type: "Feature", properties: { code: "M-B", name: "Beta", pref: "P-1" }, geometry: square(3, 3, 5, 5) },
    { type: "Feature", properties: { code: "M-C", name: "Gamma", pref: "P-2" }, geometry: square(12, 2, 14, 4) },
    // stamped P-1 but geometry entirely OUTSIDE both prefectures — exercises
    // the no-prefecture fallback scan (NE-vs-OSM coastline mismatch stand-in)
    { type: "Feature", properties: { code: "M-D", name: "Delta", pref: "P-1" }, geometry: square(30, 30, 32, 32) },
  ],
});

const munis = parseMunicipalities(FIXTURE);

describe("parseMunicipalities", () => {
  it("lifts properties and keeps geometry", () => {
    expect(munis.map((m) => m.code)).toEqual(["M-A", "M-B", "M-C", "M-D"]);
    expect(munis[0].name).toBe("Alpha");
    expect(munis[0].pref).toBe("P-1");
    expect(munis[2].geometry.type).toBe("Polygon");
  });
});

describe("grouping", () => {
  it("groups municipalities by prefecture", () => {
    const grouped = groupByPref(munis);
    expect(grouped.get("P-1")?.map((m) => m.code)).toEqual(["M-A", "M-B", "M-D"]);
    expect(grouped.get("P-2")?.map((m) => m.code)).toEqual(["M-C"]);
    expect(municipalitiesOfPref(munis, "P-9")).toEqual([]);
  });
});

describe("visitedMunicipalities", () => {
  it("resolves a point through its prefecture's municipalities", () => {
    expect(visitedMunicipalities([{ lat: 1, lng: 1 }], munis, PREFS)).toEqual(new Set(["M-A"]));
    expect(visitedMunicipalities([{ lat: 3, lng: 13 }], munis, PREFS)).toEqual(new Set(["M-C"]));
  });

  it("rejects points inside a prefecture but outside every municipality", () => {
    expect(visitedMunicipalities([{ lat: 8, lng: 8 }], munis, PREFS).size).toBe(0);
  });

  it("the prefecture pre-filter matches a brute-force scan", () => {
    const points = [
      { lat: 1, lng: 1 },
      { lat: 4, lng: 4 },
      { lat: 3, lng: 13 },
      { lat: 8, lng: 8 },
      { lat: 3.5, lng: 3.5 }, // inside M-B
    ];
    const withPrefs = visitedMunicipalities(points, munis, PREFS);
    const bruteForce = visitedMunicipalities(points, munis, []); // no prefs → every point falls back to the full scan
    expect(withPrefs).toEqual(bruteForce);
    expect(withPrefs).toEqual(new Set(["M-A", "M-B", "M-C"]));
  });

  it("falls back to a full scan when no prefecture resolves", () => {
    // M-D sits outside both prefectures; its point must still resolve
    expect(visitedMunicipalities([{ lat: 31, lng: 31 }], munis, PREFS)).toEqual(new Set(["M-D"]));
  });

  it("stays empty on empty input", () => {
    expect(visitedMunicipalities([], munis, PREFS).size).toBe(0);
    expect(visitedMunicipalities([{ lat: 1, lng: 1 }], [], PREFS).size).toBe(0);
  });
});

describe("completion stats", () => {
  it("counts overall completion, ignoring stray codes", () => {
    const s = municipalCompletion(new Set(["M-A", "M-C", "NOT-A-CODE"]), munis);
    expect(s).toMatchObject({ count: 2, total: 4, pct: 50 });
  });

  it("counts per-prefecture completion", () => {
    const s = prefMunicipalStats(new Set(["M-A", "M-C"]), munis, "P-1");
    expect(s.count).toBe(1);
    expect(s.total).toBe(3);
    expect(prefMunicipalStats(new Set(), munis, "P-9").total).toBe(0);
  });
});

describe("prefOfGeometry (vendor-time stamping logic)", () => {
  it("stamps by centroid for a geometry well inside a prefecture", () => {
    expect(prefOfGeometry(square(3, 3, 5, 5), PREFS)).toBe("P-1");
    expect(prefOfGeometry(square(12, 2, 14, 4), PREFS)).toBe("P-2");
  });

  it("stamps a C-shaped geometry whose vertex mean falls in its own mouth", () => {
    // The mean lands at ~(13, 3.7) — outside the C itself but still inside
    // P-2, which is all the centroid tier needs.
    const cShape = {
      type: "Polygon" as const,
      coordinates: [
        [
          [11, 1],
          [15, 1],
          [15, 2],
          [12, 2],
          [12, 6],
          [15, 6],
          [15, 7],
          [11, 7],
          [11, 1],
        ],
      ],
    };
    expect(prefOfGeometry(cShape, PREFS)).toBe("P-2");
  });

  it("uses the interior-blend tier when the vertex mean lands in the sea", () => {
    // A pier jutting south out of P-2: mean ≈ (9.8, -2.75) is open sea, and
    // the NEAREST bbox center is P-1 — so a P-2 result proves the blend
    // toward the (10.4, 0.5) vertex resolved it, not the distance fallback.
    expect(prefOfGeometry(square(9.2, -6, 10.4, 0.5), PREFS)).toBe("P-2");
  });

  it("falls back to the nearest prefecture when nothing contains the geometry", () => {
    // An islet in the sea, closer to P-2's frame than P-1's
    expect(prefOfGeometry(square(24, 4, 25, 5), PREFS)).toBe("P-2");
    expect(prefOfGeometry(square(-6, 4, -5, 5), PREFS)).toBe("P-1");
  });
});

// Smoke tests against the vendored geoBoundaries data — they self-skip when
// scripts/fetch-municipalities.mjs hasn't run (offline clone), matching how
// hasMunicipalData gates the tier at runtime.
describe("vendored data", () => {
  it("gates availability on the vendored file", () => {
    expect(hasMunicipalData("jp")).toBe(MUNICIPAL_COUNTRY_CODES.includes("jp"));
    expect(hasMunicipalData("zz")).toBe(false);
  });

  it.skipIf(!hasMunicipalData("jp"))("ships pref-stamped municipalities covering all 47 prefectures", async () => {
    const jp = await loadMunicipalities("jp");
    expect(jp.length).toBeGreaterThan(1700);
    for (const m of jp) expect(m.pref).toMatch(/^JP-\d{2}$/);
    const grouped = groupByPref(jp);
    expect(grouped.size).toBe(47);
    // per-prefecture totals must sum back to the full count
    let sum = 0;
    for (const list of grouped.values()) sum += list.length;
    expect(sum).toBe(jp.length);
    // Hokkaido's 179 municipalities are a well-known ground truth
    expect(grouped.get("JP-01")?.length).toBe(179);
  });

  it.skipIf(!hasMunicipalData("jp"))("resolves famous city pins to their municipality", async () => {
    const jp = await loadMunicipalities("jp");
    const byCode = new Map(jp.map((m) => [m.code, m]));

    const shibuya = await municipalityOf(35.658, 139.7016);
    expect(shibuya).not.toBeNull();
    expect(byCode.get(shibuya!)?.name).toBe("Shibuya");
    expect(byCode.get(shibuya!)?.pref).toBe("JP-13");

    const naha = await municipalityOf(26.2124, 127.6809);
    expect(byCode.get(naha!)?.name).toBe("Naha");
    expect(byCode.get(naha!)?.pref).toBe("JP-47");

    expect(await municipalityOf(35.0, 135.0 - 40)).toBeNull(); // deep in the sea of nowhere
  });
});

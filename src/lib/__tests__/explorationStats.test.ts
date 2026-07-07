import { describe, expect, it } from "vitest";
import { aggregateExploration, type ExplorationPoint } from "../explorationStats";
import type { ResolvedMunicipality } from "../geo/municipalResolver";

const muni = (cc: string, code: string): ResolvedMunicipality => ({ countryCode: cc, code, name: code });

describe("aggregateExploration", () => {
  it("counts distinct municipalities and countries with per-country coverage", () => {
    const points: ExplorationPoint[] = [
      { lat: 1, lng: 1, countryCode: "jp" },
      { lat: 2, lng: 2, countryCode: "jp" },
      { lat: 3, lng: 3, countryCode: "jp" }, // same municipality as (1,1) → deduped
      { lat: 4, lng: 4, countryCode: "fr" },
      { lat: 5, lng: 5, countryCode: "us" }, // country counts, municipality unresolved
      { lat: 6, lng: 6, countryCode: "" }, // ocean-ish, no country, unresolved
    ];
    const resolved: Record<string, ResolvedMunicipality> = {
      "1,1": muni("jp", "JP-A"),
      "2,2": muni("jp", "JP-B"),
      "3,3": muni("jp", "JP-A"),
      "4,4": muni("fr", "FR-X"),
    };
    const totals: Record<string, number> = { jp: 1745, fr: 96, us: 3233 };

    const agg = aggregateExploration(
      points,
      (lat, lng) => resolved[`${lat},${lng}`] ?? null,
      (cc) => totals[cc] ?? 0,
      (cc) => cc.toUpperCase(),
    );

    expect(agg.municipalitiesVisited).toBe(3); // JP-A, JP-B, FR-X
    expect(agg.countriesVisited).toBe(3); // jp, fr, us ("" excluded)
    // richest coverage first, then name
    expect(agg.perCountry).toEqual([
      { cc: "jp", name: "JP", visited: 2, total: 1745 },
      { cc: "fr", name: "FR", visited: 1, total: 96 },
      { cc: "us", name: "US", visited: 0, total: 3233 },
    ]);
  });

  it("counts a country known only from a municipality resolution", () => {
    const agg = aggregateExploration(
      [{ lat: 9, lng: 9, countryCode: "" }],
      () => muni("de", "DE-1"),
      () => 10,
      (cc) => cc,
    );
    expect(agg.countriesVisited).toBe(1);
    expect(agg.municipalitiesVisited).toBe(1);
    expect(agg.perCountry).toEqual([{ cc: "de", name: "de", visited: 1, total: 10 }]);
  });

  it("is all-zero on empty input", () => {
    const agg = aggregateExploration([], () => null, () => 0, (cc) => cc);
    expect(agg).toEqual({ municipalitiesVisited: 0, countriesVisited: 0, perCountry: [] });
  });

  it("never lets coverage exceed the total it is given (denominator is authoritative)", () => {
    const points: ExplorationPoint[] = [
      { lat: 1, lng: 1, countryCode: "va" },
      { lat: 2, lng: 2, countryCode: "va" },
    ];
    const resolved: Record<string, ResolvedMunicipality> = {
      "1,1": muni("va", "V-1"),
      "2,2": muni("va", "V-2"),
    };
    const agg = aggregateExploration(
      points,
      (lat, lng) => resolved[`${lat},${lng}`] ?? null,
      () => 2, // exactly two units
      (cc) => cc,
    );
    expect(agg.perCountry[0]).toEqual({ cc: "va", name: "va", visited: 2, total: 2 });
  });
});

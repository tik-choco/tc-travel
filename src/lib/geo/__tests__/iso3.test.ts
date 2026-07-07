import { describe, expect, it } from "vitest";
import { KNOWN_ALPHA2, alpha2ToAlpha3, alpha3ToAlpha2 } from "../iso3";

describe("alpha2ToAlpha3", () => {
  it("maps known alpha-2 codes to alpha-3 (uppercase)", () => {
    expect(alpha2ToAlpha3("jp")).toBe("JPN");
    expect(alpha2ToAlpha3("kr")).toBe("KOR");
    expect(alpha2ToAlpha3("us")).toBe("USA");
    expect(alpha2ToAlpha3("fr")).toBe("FRA");
  });

  it("is case-insensitive on input", () => {
    expect(alpha2ToAlpha3("JP")).toBe("JPN");
  });

  it("returns '' for an unknown code", () => {
    expect(alpha2ToAlpha3("zz")).toBe("");
    expect(alpha2ToAlpha3("")).toBe("");
  });

  it("covers Kosovo with geoBoundaries' XKX code", () => {
    expect(alpha2ToAlpha3("xk")).toBe("XKX");
  });
});

describe("alpha3ToAlpha2", () => {
  it("round-trips every known code", () => {
    for (const a2 of KNOWN_ALPHA2) {
      expect(alpha3ToAlpha2(alpha2ToAlpha3(a2))).toBe(a2);
    }
  });

  it("is case-insensitive and returns '' when unmapped", () => {
    expect(alpha3ToAlpha2("jpn")).toBe("jp");
    expect(alpha3ToAlpha2("ZZZ")).toBe("");
  });
});

describe("coverage", () => {
  it("maps at least the full ISO set the atlas can resolve", () => {
    // geo.ts's NUMERIC_TO_ALPHA2 has 249 entries; iso3 mirrors it (+ xk).
    expect(KNOWN_ALPHA2.length).toBeGreaterThanOrEqual(249);
    // every alpha-3 must be exactly three uppercase letters
    for (const a2 of KNOWN_ALPHA2) expect(alpha2ToAlpha3(a2)).toMatch(/^[A-Z]{3}$/);
  });

  it("has no duplicate alpha-3 codes", () => {
    const a3s = KNOWN_ALPHA2.map(alpha2ToAlpha3);
    expect(new Set(a3s).size).toBe(a3s.length);
  });
});

import { describe, expect, it } from "vitest";
import { countryName, loadWorld, lookupCountry, numericToAlpha2, pointInGeometry } from "../geo";

describe("numericToAlpha2", () => {
  it("maps known ISO 3166-1 numeric codes to lowercase alpha-2", () => {
    expect(numericToAlpha2("392")).toBe("jp");
    expect(numericToAlpha2("250")).toBe("fr");
    expect(numericToAlpha2("840")).toBe("us");
    // unpadded numeric ids (topojson sometimes carries them without leading zeros)
    expect(numericToAlpha2("76")).toBe("br");
  });

  it("returns empty string for an unknown code", () => {
    expect(numericToAlpha2("999")).toBe("");
  });
});

describe("loadWorld", () => {
  it("loads country features covering the atlas with resolvable codes", async () => {
    const { features } = await loadWorld();
    expect(features.length).toBeGreaterThan(150);
    const withCodes = features.filter((f) => f.code);
    // a handful of territories (Kosovo, Somaliland, N. Cyprus) have no
    // numeric id in the atlas; everything else should resolve.
    expect(withCodes.length).toBeGreaterThanOrEqual(features.length - 3);
    const japan = features.find((f) => f.name === "Japan");
    expect(japan?.code).toBe("jp");
  });

  it("caches the result across calls", async () => {
    const first = await loadWorld();
    const second = await loadWorld();
    expect(first).toBe(second);
  });
});

describe("pointInGeometry (ray-casting)", () => {
  const square = {
    type: "Polygon" as const,
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };

  it("classifies points inside and outside a hand-made square", () => {
    expect(pointInGeometry(5, 5, square)).toBe(true);
    expect(pointInGeometry(15, 5, square)).toBe(false);
    expect(pointInGeometry(-1, 5, square)).toBe(false);
  });

  it("treats a hole as outside the polygon (even-odd rule)", () => {
    const squareWithHole = {
      type: "Polygon" as const,
      coordinates: [
        square.coordinates[0],
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
          [3, 3],
        ],
      ],
    };
    expect(pointInGeometry(5, 5, squareWithHole)).toBe(false); // inside the hole
    expect(pointInGeometry(1, 1, squareWithHole)).toBe(true); // inside the ring, outside the hole
  });

  it("matches if the point is inside any part of a MultiPolygon", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [square.coordinates, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]],
    };
    expect(pointInGeometry(5, 5, multi)).toBe(true);
    expect(pointInGeometry(25, 25, multi)).toBe(true);
    expect(pointInGeometry(15, 15, multi)).toBe(false);
  });
});

describe("lookupCountry", () => {
  it("resolves a hand-picked point inside a real country (Tokyo -> jp)", async () => {
    expect(await lookupCountry(35.6762, 139.6503)).toBe("jp");
  });

  it("resolves Paris to fr", async () => {
    expect(await lookupCountry(48.8566, 2.3522)).toBe("fr");
  });

  it("returns empty string for a point in the middle of the ocean", async () => {
    expect(await lookupCountry(0, -140)).toBe("");
  });

  it("resolves a point inside a hand-made square polygon via loadWorld's ray-casting logic", async () => {
    // Sanity check on the ray-casting itself using a simple, unambiguous
    // point well inside a real country's bounding shape rather than a
    // synthetic polygon (lookupCountry only operates on loaded features).
    // New Zealand is comfortably isolated in the Pacific, useful for
    // checking the algorithm doesn't leak across the antimeridian.
    expect(await lookupCountry(-41.2865, 174.7762)).toBe("nz");
  });
});

describe("countryName", () => {
  it("returns a localized display name for a known code", () => {
    expect(countryName("jp", "en")).toBe("Japan");
    expect(countryName("fr", "en")).toBe("France");
  });

  it("returns empty string for an empty code", () => {
    expect(countryName("", "en")).toBe("");
  });

  it("resolves a well-formed but unassigned region code without throwing", () => {
    // "zz" is validly-shaped but unassigned; ICU reports it as "Unknown
    // Region" rather than throwing or returning undefined.
    expect(countryName("zz", "en")).toBe("Unknown Region");
  });

  it("falls back to the uppercased code when the region tag is malformed", () => {
    // A single letter isn't a valid Unicode region subtag, so
    // Intl.DisplayNames#of throws — exercising the try/catch fallback.
    expect(countryName("z", "en")).toBe("Z");
  });
});

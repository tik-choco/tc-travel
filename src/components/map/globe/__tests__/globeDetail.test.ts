import { describe, expect, it } from "vitest";
import {
  COUNTRY_BORDER_FADE_IN,
  COUNTRY_BORDER_FULL,
  LABEL_FADE_IN,
  LABEL_FULL,
  MUNICIPAL_EXIT,
  MUNICIPAL_FADE_IN,
  MUNICIPAL_FULL,
  MUNICIPAL_PRELOAD,
  SUBNATIONAL_EXIT,
  SUBNATIONAL_FADE_IN,
  SUBNATIONAL_FULL,
  buildBorderGeometry,
  countryBorderOpacity,
  labelOpacity,
  municipalOpacity,
  subnationalOpacity,
} from "../globeDetail";
import { latLngToVec3 } from "../geoSphere";

// Dolly range of the scene camera (globeScene MIN_DIST/MAX_DIST).
const MIN_DIST = 1.16;
const MAX_DIST = 3.4;

describe("LOD thresholds", () => {
  it("orders the layers: world borders, then subdivisions, then names", () => {
    expect(COUNTRY_BORDER_FADE_IN).toBeGreaterThan(COUNTRY_BORDER_FULL);
    expect(SUBNATIONAL_FADE_IN).toBeGreaterThan(SUBNATIONAL_FULL);
    expect(LABEL_FADE_IN).toBeGreaterThan(LABEL_FULL);
    expect(COUNTRY_BORDER_FADE_IN).toBeGreaterThan(SUBNATIONAL_FADE_IN);
    expect(SUBNATIONAL_FADE_IN).toBeGreaterThanOrEqual(LABEL_FADE_IN);
    // Every layer must be reachable within the camera's dolly range.
    for (const d of [COUNTRY_BORDER_FULL, SUBNATIONAL_FULL, LABEL_FULL]) {
      expect(d).toBeGreaterThan(MIN_DIST);
    }
    expect(COUNTRY_BORDER_FADE_IN).toBeLessThan(MAX_DIST);
  });

  it("keeps a hysteresis band so the sub-national layer never thrashes", () => {
    expect(SUBNATIONAL_EXIT).toBeGreaterThan(SUBNATIONAL_FADE_IN);
  });

  it("municipalities are the deepest tier, appearing only past full prefectures", () => {
    // ~220m-simplified geometry: never drawn while the prefecture tier is
    // still the right level of detail.
    expect(MUNICIPAL_FADE_IN).toBeLessThan(SUBNATIONAL_FULL);
    expect(MUNICIPAL_PRELOAD).toBeLessThanOrEqual(SUBNATIONAL_FULL);
    expect(MUNICIPAL_FULL).toBeGreaterThan(MIN_DIST); // reachable at max dolly
    // Hysteresis: the keep band strictly contains the build band.
    expect(MUNICIPAL_EXIT).toBeGreaterThan(MUNICIPAL_PRELOAD);
    expect(MUNICIPAL_PRELOAD).toBeGreaterThanOrEqual(MUNICIPAL_FADE_IN);
  });
});

describe("opacity ramps", () => {
  it("stays fully hidden when zoomed out (the far view keeps its painted look)", () => {
    expect(countryBorderOpacity(MAX_DIST)).toBe(0);
    expect(countryBorderOpacity(COUNTRY_BORDER_FADE_IN)).toBe(0);
    expect(subnationalOpacity(SUBNATIONAL_FADE_IN)).toBe(0);
    expect(labelOpacity(LABEL_FADE_IN)).toBe(0);
    expect(municipalOpacity(MUNICIPAL_FADE_IN)).toBe(0);
  });

  it("reaches full strength at (and below) each layer's full-zoom threshold", () => {
    expect(countryBorderOpacity(COUNTRY_BORDER_FULL)).toBeGreaterThan(0.3);
    expect(countryBorderOpacity(MIN_DIST)).toBe(countryBorderOpacity(COUNTRY_BORDER_FULL));
    expect(subnationalOpacity(MIN_DIST)).toBe(subnationalOpacity(SUBNATIONAL_FULL));
    expect(labelOpacity(MIN_DIST)).toBeGreaterThan(0.8);
    expect(municipalOpacity(MIN_DIST)).toBe(municipalOpacity(MUNICIPAL_FULL));
    expect(municipalOpacity(MIN_DIST)).toBeGreaterThan(0.2);
  });

  it("orders the line weights: country > prefecture > municipality", () => {
    // WebGL lines are 1px everywhere — max opacity IS the visual weight.
    const country = countryBorderOpacity(MIN_DIST);
    const prefecture = subnationalOpacity(MIN_DIST);
    const municipality = municipalOpacity(MIN_DIST);
    expect(country).toBeGreaterThan(prefecture);
    expect(prefecture).toBeGreaterThan(municipality);
    expect(municipality).toBeGreaterThan(0);
  });

  it("fades monotonically as the camera descends", () => {
    for (const ramp of [countryBorderOpacity, subnationalOpacity, labelOpacity, municipalOpacity]) {
      let prev = ramp(MAX_DIST);
      for (let d = MAX_DIST; d >= MIN_DIST; d -= 0.02) {
        const v = ramp(d);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });
});

describe("buildBorderGeometry", () => {
  it("turns a closed ring of N points into N segments on the sphere", () => {
    const square: number[][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0], // GeoJSON rings repeat the first point
    ];
    const geometry = buildBorderGeometry([{ type: "Polygon", coordinates: [square] }], 1.002);
    const pos = geometry.getAttribute("position");
    expect(pos.count).toBe(8); // 4 segments × 2 endpoints
    // Every vertex sits on the requested radius (float32 storage → ~1e-7).
    for (let i = 0; i < pos.count; i++) {
      expect(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeCloseTo(1.002, 6);
    }
    // First segment starts at the ring's first lat/lng.
    const [x, y, z] = latLngToVec3(0, 0, 1.002);
    expect(pos.getX(0)).toBeCloseTo(x, 6);
    expect(pos.getY(0)).toBeCloseTo(y, 6);
    expect(pos.getZ(0)).toBeCloseTo(z, 6);
    geometry.dispose();
  });

  it("merges MultiPolygons and multiple geometries into one buffer", () => {
    const tri: number[][] = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 0],
    ];
    const geometry = buildBorderGeometry(
      [
        { type: "MultiPolygon", coordinates: [[tri], [tri]] },
        { type: "Polygon", coordinates: [tri] },
      ],
      1,
    );
    expect(geometry.getAttribute("position").count).toBe(3 * 3 * 2); // 3 rings × 3 segments × 2 ends
    geometry.dispose();
  });
});

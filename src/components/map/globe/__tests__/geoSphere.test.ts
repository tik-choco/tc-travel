import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  geometryAnchor,
  latLngToEquirect,
  latLngToUv,
  latLngToVec3,
  shortestAngle,
  vec3ToLatLng,
  wrapLng,
} from "../geoSphere";

describe("wrapLng", () => {
  it("normalizes into [-180, 180)", () => {
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(360)).toBe(0);
    expect(wrapLng(180)).toBe(-180); // half-open on the east side
    expect(wrapLng(540)).toBe(-180);
  });
});

describe("latLngToVec3", () => {
  it("places the cardinal points where three's sphere expects them", () => {
    // Prime meridian on the equator → +X (three's sphere starts phi at the
    // antimeridian with a -cos on x, so Greenwich lands on +X).
    expect(latLngToVec3(0, 0).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0, 0]);
    expect(latLngToVec3(90, 0)[1]).toBeCloseTo(1, 12); // north pole = +Y
    expect(latLngToVec3(-90, 0)[1]).toBeCloseTo(-1, 12);
    const [x90, y90, z90] = latLngToVec3(0, 90);
    expect(x90).toBeCloseTo(0, 12);
    expect(y90).toBeCloseTo(0, 12);
    expect(z90).toBeCloseTo(-1, 12); // 90°E → -Z
    expect(latLngToVec3(0, -90)[2]).toBeCloseTo(1, 12); // 90°W → +Z
  });

  it("scales by radius", () => {
    const [x, y, z] = latLngToVec3(45, 45, 3);
    expect(Math.hypot(x, y, z)).toBeCloseTo(3, 10);
  });
});

describe("round trips", () => {
  it("lat/lng → xyz → lat/lng across the world grid", () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lng = -170; lng <= 170; lng += 30) {
        const [x, y, z] = latLngToVec3(lat, lng);
        const back = vec3ToLatLng(x, y, z);
        expect(back.lat).toBeCloseTo(lat, 8);
        expect(back.lng).toBeCloseTo(lng, 8);
      }
    }
  });

  it("accepts non-unit vectors (raycast hit points, camera positions)", () => {
    const [x, y, z] = latLngToVec3(35.68, 139.76, 2.5); // Tokyo, from altitude
    const back = vec3ToLatLng(x, y, z);
    expect(back.lat).toBeCloseTo(35.68, 8);
    expect(back.lng).toBeCloseTo(139.76, 8);
  });
});

describe("uv / equirect mapping", () => {
  it("maps the origin to the texture center and poles to the v extremes", () => {
    expect(latLngToUv(0, 0)).toEqual([0.5, 0.5]);
    expect(latLngToUv(90, 0)[1]).toBe(1);
    expect(latLngToUv(-90, 0)[1]).toBe(0);
    expect(latLngToUv(0, -180)[0]).toBe(0);
  });

  it("latLngToEquirect matches geoMath.project's convention", () => {
    expect(latLngToEquirect(0, 0, 1000, 500)).toEqual([500, 250]);
    expect(latLngToEquirect(90, -180, 1000, 500)).toEqual([0, 0]);
    expect(latLngToEquirect(-90, 0, 1000, 500)[1]).toBe(500);
  });

  it("agrees with the ACTUAL uv/position attributes of THREE.SphereGeometry", () => {
    // This is the contract everything hangs on: a canvas painted with
    // latLngToEquirect must land on the sphere exactly where latLngToVec3
    // puts pins. Verify against real geometry, not our own assumptions.
    const geom = new THREE.SphereGeometry(1, 16, 12);
    const pos = geom.getAttribute("position");
    const uv = geom.getAttribute("uv");
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (Math.abs(y) > 0.98) continue; // poles carry three's uv offset hack
      const { lat, lng } = vec3ToLatLng(pos.getX(i), y, pos.getZ(i));
      const [u, v] = latLngToUv(lat, lng);
      // u wraps at the seam (three duplicates the u=1 column at u=0's position).
      const du = Math.abs(u - uv.getX(i));
      expect(Math.min(du, 1 - du)).toBeLessThan(1e-6);
      expect(v).toBeCloseTo(uv.getY(i), 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    geom.dispose();
  });
});

describe("shortestAngle", () => {
  it("takes the short way around", () => {
    expect(shortestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(shortestAngle(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(shortestAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 12);
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
  });
});

describe("geometryAnchor", () => {
  it("returns the vertex mean of a polygon's outer ring", () => {
    const anchor = geometryAnchor({
      type: "Polygon",
      coordinates: [
        [
          [10, 40],
          [20, 40],
          [20, 50],
          [10, 50],
        ],
      ],
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.lat).toBeCloseTo(45, 10);
    expect(anchor!.lng).toBeCloseTo(15, 10);
  });

  it("anchors a MultiPolygon on its largest ring, not the bbox center", () => {
    // Two territories far apart (think France + French Guiana): the bbox
    // center would fall in the Atlantic; the anchor must sit on the big one.
    const mainland = [
      [0, 45],
      [1, 45],
      [2, 46],
      [1, 47],
      [0, 47],
      [0, 45],
    ];
    const island = [
      [-53, 4],
      [-52, 4],
      [-52, 5],
      [-53, 4],
    ];
    const anchor = geometryAnchor({ type: "MultiPolygon", coordinates: [[island], [mainland]] });
    expect(anchor).not.toBeNull();
    expect(anchor!.lng).toBeGreaterThan(-1);
    expect(anchor!.lat).toBeGreaterThan(44);
  });

  it("returns null for empty geometry", () => {
    expect(geometryAnchor({ type: "Polygon", coordinates: [] })).toBeNull();
    expect(geometryAnchor({ type: "LineString", coordinates: [] })).toBeNull();
  });
});

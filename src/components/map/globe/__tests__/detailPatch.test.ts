import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  PATCH_EXIT,
  PATCH_FADE_IN,
  PATCH_FULL,
  buildPatchGeometry,
  computeVisibleWindow,
  geoWindowToPixelWindow,
  patchCanvasSize,
  patchOpacity,
  shouldRebuildPatch,
  windowDriftDeg,
  type GeoWindow,
} from "../detailPatch";
import { COUNTRY_BORDER_FULL } from "../globeDetail";
import { latLngToVec3, vec3ToLatLng } from "../geoSphere";

/** Same camera setup globeScene.ts uses: spherical coords around the origin,
 *  always looking at the globe's center. */
function makeCamera(dist: number, phi: number, theta: number, aspect = 1): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 20);
  camera.position.setFromSphericalCoords(dist, phi, theta);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe("PATCH thresholds", () => {
  it("takes over exactly where globeDetail documents the base texture starting to blur", () => {
    expect(PATCH_FADE_IN).toBe(COUNTRY_BORDER_FULL);
  });

  it("keeps a hysteresis band so hovering at the threshold doesn't thrash", () => {
    expect(PATCH_EXIT).toBeGreaterThan(PATCH_FADE_IN);
    expect(PATCH_FULL).toBeLessThan(PATCH_FADE_IN);
  });
});

describe("patchOpacity", () => {
  it("is fully hidden at and above the fade-in distance", () => {
    expect(patchOpacity(PATCH_FADE_IN)).toBe(0);
    expect(patchOpacity(PATCH_FADE_IN + 1)).toBe(0);
  });

  it("reaches full strength at (and below) the full-zoom threshold", () => {
    expect(patchOpacity(PATCH_FULL)).toBe(1);
    expect(patchOpacity(1.0)).toBe(1);
  });

  it("fades in monotonically as the camera descends", () => {
    let prev = patchOpacity(PATCH_FADE_IN);
    for (let d = PATCH_FADE_IN; d >= PATCH_FULL; d -= 0.01) {
      const v = patchOpacity(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("computeVisibleWindow", () => {
  it("centers the window on the sub-camera lat/lng", () => {
    const camera = makeCamera(1.3, Math.PI / 2, 0);
    const window = computeVisibleWindow(camera)!;
    expect(window).not.toBeNull();
    const sub = vec3ToLatLng(camera.position.x, camera.position.y, camera.position.z);
    expect(window.centerLat).toBeCloseTo(sub.lat, 6);
    expect(window.centerLng).toBeCloseTo(sub.lng, 6);
    // The center itself is always inside its own window.
    expect(window.latMin).toBeLessThanOrEqual(window.centerLat);
    expect(window.latMax).toBeGreaterThanOrEqual(window.centerLat);
    expect(window.lngMin).toBeLessThanOrEqual(window.centerLng);
    expect(window.lngMax).toBeGreaterThanOrEqual(window.centerLng);
  });

  it("shrinks as the camera dollies in closer", () => {
    const near = computeVisibleWindow(makeCamera(1.16, Math.PI / 2, 0))!;
    const far = computeVisibleWindow(makeCamera(1.8, Math.PI / 2, 0))!;
    const spanNear = near.lngMax - near.lngMin;
    const spanFar = far.lngMax - far.lngMin;
    expect(spanNear).toBeLessThan(spanFar);
  });

  it("stays continuous across the antimeridian instead of jumping", () => {
    // Centered right on the seam — a naive lngMin/lngMax pair computed by
    // wrapping each corner independently would jump from ~+180 to ~-180.
    const camera = makeCamera(1.3, Math.PI / 2, Math.PI); // theta=π → lng ≈ 180
    const window = computeVisibleWindow(camera)!;
    expect(window.lngMax - window.lngMin).toBeGreaterThan(0);
    expect(window.lngMax - window.lngMin).toBeLessThan(90); // sane span, not a false ~360° wrap
  });

  it("pads the hit-tested extent with the margin", () => {
    const camera = makeCamera(1.3, Math.PI / 2, 0);
    const tight = computeVisibleWindow(camera, 1, 0)!;
    const padded = computeVisibleWindow(camera, 1, 6)!;
    expect(padded.latMax - padded.latMin).toBeCloseTo(tight.latMax - tight.latMin + 12, 6);
  });
});

describe("windowDriftDeg / shouldRebuildPatch", () => {
  const base: GeoWindow = { centerLat: 10, centerLng: 20, latMin: 0, latMax: 20, lngMin: 10, lngMax: 30 };

  it("always rebuilds when nothing has been built yet", () => {
    expect(shouldRebuildPatch(base, null)).toBe(true);
  });

  it("does not rebuild for a negligible drift", () => {
    const nearby: GeoWindow = { ...base, centerLat: 10.1, centerLng: 20.1, latMin: 0.1, latMax: 20.1, lngMin: 10.1, lngMax: 30.1 };
    expect(windowDriftDeg(nearby, base)).toBeLessThan(1);
    expect(shouldRebuildPatch(nearby, base)).toBe(false);
  });

  it("rebuilds once the center has drifted far enough", () => {
    const moved: GeoWindow = { ...base, centerLat: 25, latMin: 15, latMax: 35 };
    expect(shouldRebuildPatch(moved, base)).toBe(true);
  });

  it("rebuilds on a zoom-band change even without much center drift", () => {
    const zoomedIn: GeoWindow = { ...base, latMin: 5, latMax: 15, lngMin: 15, lngMax: 25 }; // half the span
    expect(shouldRebuildPatch(zoomedIn, base)).toBe(true);
  });

  it("is symmetric and zero for identical windows", () => {
    expect(windowDriftDeg(base, base)).toBe(0);
    expect(shouldRebuildPatch(base, base)).toBe(false);
  });
});

describe("geoWindowToPixelWindow", () => {
  it("maps a window not crossing the seam onto monotonic base-canvas pixels", () => {
    const win: GeoWindow = { centerLat: 0, centerLng: 0, latMin: -10, latMax: 10, lngMin: -10, lngMax: 10 };
    const px = geoWindowToPixelWindow(win, 3600, 1800); // 10 px/deg, easy to eyeball
    expect(px.x0).toBeCloseTo(1700, 6); // (0-10+180)/360*3600
    expect(px.x1).toBeCloseTo(1900, 6);
    expect(px.y0).toBeCloseTo(800, 6); // (90-10)/180*1800
    expect(px.y1).toBeCloseTo(1000, 6);
    expect(px.x1).toBeGreaterThan(px.x0);
    expect(px.y1).toBeGreaterThan(px.y0);
  });

  it("keeps a seam-straddling window monotonic even though it runs outside [0, baseW]", () => {
    const win: GeoWindow = { centerLat: 0, centerLng: 179, latMin: -5, latMax: 5, lngMin: 170, lngMax: 188 };
    const px = geoWindowToPixelWindow(win, 3600, 1800);
    expect(px.x1).toBeGreaterThan(px.x0);
    // The window's east edge (188°) is past the atlas's own [0, baseW) domain.
    expect(px.x1).toBeGreaterThan(3600);
  });
});

describe("patchCanvasSize", () => {
  it("keeps equal px/deg density on both axes (no equirectangular distortion)", () => {
    const win: GeoWindow = { centerLat: 0, centerLng: 0, latMin: -5, latMax: 5, lngMin: -8, lngMax: 8 };
    const { width, height } = patchCanvasSize(win, 2048);
    expect(width / 16).toBeCloseTo(height / 10, 1);
  });

  it("respects the max-dimension cap", () => {
    const win: GeoWindow = { centerLat: 0, centerLng: 0, latMin: -40, latMax: 40, lngMin: -60, lngMax: 60 };
    const { width, height } = patchCanvasSize(win, 1024);
    expect(width).toBeLessThanOrEqual(1024);
    expect(height).toBeLessThanOrEqual(1024);
  });

  it("never collapses to zero for a degenerate window", () => {
    const win: GeoWindow = { centerLat: 0, centerLng: 0, latMin: 0, latMax: 0, lngMin: 0, lngMax: 0 };
    const { width, height } = patchCanvasSize(win);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("buildPatchGeometry", () => {
  it("produces a sphere segment whose corners land on the window's lat/lng bounds", () => {
    const win: GeoWindow = { centerLat: 0, centerLng: 0, latMin: -10, latMax: 10, lngMin: -10, lngMax: 10 };
    const geometry = buildPatchGeometry(win, 1.001);
    const pos = geometry.getAttribute("position");
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const { lat, lng } = vec3ToLatLng(pos.getX(i), pos.getY(i), pos.getZ(i));
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      // Every vertex sits on the requested radius.
      expect(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeCloseTo(1.001, 5);
    }
    expect(minLat).toBeCloseTo(win.latMin, 4);
    expect(maxLat).toBeCloseTo(win.latMax, 4);
    expect(minLng).toBeCloseTo(win.lngMin, 4);
    expect(maxLng).toBeCloseTo(win.lngMax, 4);
    geometry.dispose();
  });

  it("aligns with geoSphere's own lat/lng → vec3 convention", () => {
    const win: GeoWindow = { centerLat: 20, centerLng: 30, latMin: 10, latMax: 30, lngMin: 20, lngMax: 40 };
    const geometry = buildPatchGeometry(win, 1);
    const pos = geometry.getAttribute("position");
    const [ex, ey, ez] = latLngToVec3(win.latMax, win.lngMin, 1); // one corner
    let found = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i) - ex, pos.getY(i) - ey, pos.getZ(i) - ez) < 1e-4) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    geometry.dispose();
  });
});

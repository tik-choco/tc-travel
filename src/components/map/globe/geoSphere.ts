// Lat/lng ↔ unit-sphere math for the 3D globe. The xyz/uv conventions here
// match three.js SphereGeometry's parametrization EXACTLY (verified by the
// unit test against real geometry attributes), so a texture painted with the
// plain equirectangular mapping — the same one geoMath.ts uses for the SVG
// map — lands on the sphere with pins/photos/countries all in agreement.
// Deliberately three-free: pure tuples, trivially testable in node.

import type { SimpleGeometry } from "../geoMath";

export interface LatLng {
  lat: number;
  lng: number;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Normalizes any longitude into [-180, 180). */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * lat/lng → xyz on a sphere of the given radius, +Y = north pole, and the
 * prime meridian on +X — the exact vertex layout SphereGeometry produces for
 * an equirectangular texture (note the -cos on x: three's sphere is built
 * with phi = 0 at the antimeridian, sweeping east).
 */
export function latLngToVec3(lat: number, lng: number, radius = 1): [number, number, number] {
  const theta = (90 - lat) * DEG2RAD; // polar angle from the north pole
  const phi = (lng + 180) * DEG2RAD; // azimuth, 0 at the antimeridian
  const sinTheta = Math.sin(theta);
  return [-radius * Math.cos(phi) * sinTheta, radius * Math.cos(theta), radius * Math.sin(phi) * sinTheta];
}

/** Inverse of latLngToVec3 for any (non-zero) vector; input need not be unit length. */
export function vec3ToLatLng(x: number, y: number, z: number): LatLng {
  const r = Math.hypot(x, y, z) || 1;
  const clampedY = Math.min(1, Math.max(-1, y / r));
  const lat = 90 - Math.acos(clampedY) * RAD2DEG;
  const lng = wrapLng(Math.atan2(z, -x) * RAD2DEG - 180);
  return { lat, lng };
}

/** Texture uv for a lat/lng, matching SphereGeometry uvs + default flipY. */
export function latLngToUv(lat: number, lng: number): [number, number] {
  return [(wrapLng(lng) + 180) / 360, (lat + 90) / 180];
}

/**
 * Equirectangular canvas pixel for a lat/lng (row 0 = north pole). The same
 * linear mapping as geoMath.project, parameterized on the canvas size.
 */
export function latLngToEquirect(lat: number, lng: number, width: number, height: number): [number, number] {
  return [((wrapLng(lng) + 180) / 360) * width, ((90 - lat) / 180) * height];
}

/** Shortest signed angular difference from → to, in radians, in (-π, π]. */
export function shortestAngle(from: number, to: number): number {
  const TAU = Math.PI * 2;
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Anchor point for a country's reveal flourish: the vertex mean of the
 * largest outer ring, NOT a bbox center — bbox centers land in the open
 * ocean for antimeridian-crossing and multi-territory countries, and the
 * burst is a visible reward, so it has to appear on the landmass itself.
 * (Same rationale as WorldMap's revealAnchor, expressed in lat/lng.)
 */
export function geometryAnchor(geometry: SimpleGeometry): LatLng | null {
  let ring: number[][] | null = null;
  if (geometry.type === "Polygon") {
    ring = (geometry.coordinates as number[][][])[0] ?? null;
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates as number[][][][]) {
      if (poly[0] && (!ring || poly[0].length > ring.length)) ring = poly[0];
    }
  }
  if (!ring || ring.length === 0) return null;
  let sLat = 0;
  let sLng = 0;
  for (const [lng, lat] of ring) {
    sLat += lat;
    sLng += lng;
  }
  return { lat: sLat / ring.length, lng: wrapLng(sLng / ring.length) };
}

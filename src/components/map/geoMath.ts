// Equirectangular projection + GeoJSON path building for the fog-of-war world
// map. Deliberately dependency-free (no d3-geo) — the projection is a plain
// linear lat/lng -> pixel mapping, which is all a whole-world overview needs.

export const MAP_W = 1000;
export const MAP_H = 500;

export function project(lng: number, lat: number): [number, number] {
  const x = ((lng + 180) / 360) * MAP_W;
  const y = ((90 - lat) / 180) * MAP_H;
  return [x, y];
}

export function unproject(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / MAP_W) * 360 - 180;
  const lat = 90 - (y / MAP_H) * 180;
  return { lat, lng };
}

type Ring = number[][];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

/** Minimal shape geo.ts's CountryFeature geometry is expected to satisfy (GeoJSON). */
export interface SimpleGeometry {
  type: string;
  coordinates: unknown;
}

function ringToPath(ring: Ring): string {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    const [x, y] = project(lng, lat);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

export function geometryToPath(geometry: SimpleGeometry): string {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as PolygonCoords).map(ringToPath).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as MultiPolygonCoords)
      .map((poly) => poly.map(ringToPath).join(" "))
      .join(" ");
  }
  return "";
}

/** Cheap bounding-box centroid — good enough for continent bucketing, not for rendering. */
export function geometryCentroid(geometry: SimpleGeometry): { lat: number; lng: number } {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (ring: Ring) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates as PolygonCoords) visit(ring);
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates as MultiPolygonCoords) for (const ring of poly) visit(ring);
  }
  if (!isFinite(minLng)) return { lat: 0, lng: 0 };
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Fetches geoBoundaries JPN ADM2 (市区町村, OSM-derived, CC BY-SA 2.0 — see
// docs/DATA_LICENSES.md for the required attribution) and vendors a slimmed
// FeatureCollection into src/components/map/municipal/jp.geojson for the
// municipality collection tier.
//
// Each feature's properties are stripped to { code, name, pref }:
//   code — geoBoundaries shapeID (stable identifier)
//   name — shapeName (ROMAJI; the source carries no Japanese names — a future
//          JIS-code join can add name_ja without touching this script's shape)
//   pref — ISO 3166-2 prefecture code ("JP-01".."JP-47"), stamped by testing
//          the municipality's centroid (with fallbacks) against the vendored
//          japanPrefectures.geojson. This is what lets the app pre-filter
//          1745 point-in-polygon tests down to one prefecture's worth.
// Coordinates are rounded to 3 decimals (~110 m) and sub-speck islet rings
// dropped to shrink aggressively. Safe to re-run; a failed fetch leaves any
// existing vendored file untouched and exits 0 so builds keep working offline.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "src", "components", "map", "municipal");
const prefGeojsonPath = path.join(rootDir, "src", "components", "map", "japanPrefectures.geojson");

// Direct file first (302→media.githubusercontent, fetch follows redirects);
// the geoBoundaries API as fallback resolves the current simplified URL.
const DIRECT_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/JPN/ADM2/geoBoundaries-JPN-ADM2_simplified.geojson";
const API_URL = "https://www.geoboundaries.org/api/current/gbOpen/JPN/ADM2/";

// --- geometry helpers (mirrors lib/geo pointInGeometry + municipalGeo's
// prefOfGeometry — this script is plain node and can't import the TS lib) ----

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, coordinates) {
  let inside = false;
  for (const ring of coordinates) if (pointInRing(lng, lat, ring)) inside = !inside;
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (geometry.type === "Polygon") return pointInPolygon(lng, lat, geometry.coordinates);
  return geometry.coordinates.some((poly) => pointInPolygon(lng, lat, poly));
}

function eachRing(geometry, visit) {
  if (geometry.type === "Polygon") for (const ring of geometry.coordinates) visit(ring);
  else for (const poly of geometry.coordinates) for (const ring of poly) visit(ring);
}

function ringBounds(rings) {
  const b = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < b.minLng) b.minLng = lng;
      if (lng > b.maxLng) b.maxLng = lng;
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
    }
  }
  return b;
}

function largestOuterRing(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates[0] ?? null;
  let best = null;
  for (const poly of geometry.coordinates) {
    if (poly[0] && (!best || poly[0].length > best.length)) best = poly[0];
  }
  return best;
}

function ringMean(ring) {
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of ring) {
    sx += lng;
    sy += lat;
  }
  return [sx / ring.length, sy / ring.length];
}

// --- prefecture stamping ------------------------------------------------------

const prefCollection = JSON.parse(readFileSync(prefGeojsonPath, "utf8"));
const prefs = prefCollection.features.map((f) => {
  const rings = [];
  eachRing(f.geometry, (r) => rings.push(r));
  return { code: f.properties.code, geometry: f.geometry, bounds: ringBounds(rings) };
});

function prefAt(lng, lat) {
  for (const p of prefs) {
    const b = p.bounds;
    if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
    if (pointInGeometry(lng, lat, p.geometry)) return p.code;
  }
  return "";
}

const stampStats = { centroid: 0, blend: 0, nearest: 0 };

/** Prefecture code for a municipality geometry. Tiered like municipalGeo's
 *  prefOfGeometry: (1) largest-ring vertex mean; (2) blends between that mean
 *  and sampled ring vertices, pulling test points toward the interior when
 *  the mean lands in a bay; (3) nearest prefecture by bbox-center distance —
 *  guaranteed to stamp something, so per-prefecture totals sum to the full
 *  municipality count. */
function stampPref(geometry) {
  const ring = largestOuterRing(geometry);
  if (!ring || ring.length === 0) return "";
  const [cx, cy] = ringMean(ring);
  let code = prefAt(cx, cy);
  if (code) {
    stampStats.centroid++;
    return code;
  }
  for (const t of [0.5, 0.9]) {
    const step = Math.max(1, Math.floor(ring.length / 8));
    for (let i = 0; i < ring.length; i += step) {
      const [vx, vy] = ring[i];
      code = prefAt(cx + (vx - cx) * t, cy + (vy - cy) * t);
      if (code) {
        stampStats.blend++;
        return code;
      }
    }
  }
  let bestCode = "";
  let bestDist = Infinity;
  for (const p of prefs) {
    const px = (p.bounds.minLng + p.bounds.maxLng) / 2;
    const py = (p.bounds.minLat + p.bounds.maxLat) / 2;
    const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d < bestDist) {
      bestDist = d;
      bestCode = p.code;
    }
  }
  stampStats.nearest++;
  return bestCode;
}

// --- slimming (same approach as fetch-subnational.mjs, plus a speck filter) ---

const round = (v) => Math.round(v * 1000) / 1000;
// Non-largest polygons whose bbox is under ~330 m in both axes are dropped —
// invisible at any zoom this tier renders, and Setouchi speck fields cost
// real bytes. The largest polygon is always kept, so every municipality
// stays pin-resolvable on its main landmass.
const SPECK_DEG = 0.003;
// Douglas–Peucker tolerance (~220 m): geoBoundaries' "simplified" file is
// still denser than this tier needs — geometry here only feeds
// point-in-polygon, where this is the same error class as the 3-decimal
// rounding. Together they land the vendored file under the ~2.5 MB budget.
const DP_TOLERANCE = 0.002;

function perpDist2(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const ex = p[0] - (a[0] + t * dx);
  const ey = p[1] - (a[1] + t * dy);
  return ex * ex + ey * ey;
}

function dpLine(points, tol2) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop();
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist2(points[i], points[lo], points[hi]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tol2 && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx], [maxIdx, hi]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** DP-simplifies a closed ring: split at the vertex farthest from vertex 0 so
 *  both halves have a real baseline, simplify each, rejoin closed. */
function dpRing(ring) {
  if (ring.length <= 5) return ring;
  const open = ring.slice(0, ring.length - 1); // drop closing duplicate
  let far = 1;
  let farDist = -1;
  for (let i = 1; i < open.length; i++) {
    const dx = open[i][0] - open[0][0];
    const dy = open[i][1] - open[0][1];
    const d = dx * dx + dy * dy;
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const tol2 = DP_TOLERANCE * DP_TOLERANCE;
  const a = dpLine(open.slice(0, far + 1), tol2);
  const b = dpLine([...open.slice(far), open[0]], tol2);
  return [...a, ...b.slice(1)]; // b ends on open[0], closing the ring
}

function slimRing(rawRing) {
  const ring = dpRing(rawRing);
  const out = [];
  for (const pt of ring) {
    const p = [round(pt[0]), round(pt[1])];
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  if (out.length >= 3) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  }
  return out.length >= 4 ? out : null;
}

function slimPolygon(coords) {
  const outer = slimRing(coords[0] ?? []);
  if (!outer) return null;
  const rings = [outer];
  for (const hole of coords.slice(1)) {
    const r = slimRing(hole); // holes kept: enclave municipalities must not double-match
    if (r) rings.push(r);
  }
  return rings;
}

function slimGeometry(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  // find the largest polygon (by outer-ring vertex count) — always kept
  let largestIdx = 0;
  for (let i = 1; i < polys.length; i++) {
    if ((polys[i][0]?.length ?? 0) > (polys[largestIdx][0]?.length ?? 0)) largestIdx = i;
  }
  const out = [];
  for (let i = 0; i < polys.length; i++) {
    const slimmed = slimPolygon(polys[i]);
    if (!slimmed) continue;
    if (i !== largestIdx) {
      const b = ringBounds([slimmed[0]]);
      if (b.maxLng - b.minLng < SPECK_DEG && b.maxLat - b.minLat < SPECK_DEG) continue;
    }
    out.push(slimmed);
  }
  if (out.length === 0) return null;
  return out.length === 1 ? { type: "Polygon", coordinates: out[0] } : { type: "MultiPolygon", coordinates: out };
}

// --- fetch ---------------------------------------------------------------------

async function fetchJson(url) {
  console.log(`fetching ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDataset() {
  try {
    const data = await fetchJson(DIRECT_URL);
    if (Array.isArray(data.features)) return data;
    throw new Error("unexpected payload (no features array)");
  } catch (err) {
    console.warn(`direct source failed — ${err?.message ?? err}`);
  }
  try {
    const meta = await fetchJson(API_URL);
    const url = meta?.simplifiedGeometryGeoJSON;
    if (!url) throw new Error("API response carries no simplifiedGeometryGeoJSON");
    const data = await fetchJson(url);
    if (Array.isArray(data.features)) return data;
    throw new Error("unexpected payload (no features array)");
  } catch (err) {
    console.warn(`API source failed — ${err?.message ?? err}`);
  }
  return null;
}

const dataset = await loadDataset();
if (!dataset) {
  console.log(
    "All geoBoundaries sources unreachable (offline?). Nothing written — the app builds and runs " +
      "without municipality data; re-run `npm run fetch-municipalities` when back online.",
  );
  process.exit(0);
}
console.log(`source OK (${dataset.features.length} ADM2 features)`);

const features = [];
const seen = new Set();
for (const f of dataset.features) {
  const props = f.properties ?? {};
  if (props.shapeGroup && props.shapeGroup !== "JPN") continue;
  const geometry = slimGeometry(f.geometry ?? {});
  if (!geometry) {
    console.warn(`  ! ${props.shapeName ?? "?"} (${props.shapeID ?? "?"}) degenerated entirely — skipped`);
    continue;
  }
  let code = String(props.shapeID ?? "");
  if (!code) code = `JPN-ADM2-${features.length + 1}`;
  while (seen.has(code)) code = `${code}x`;
  seen.add(code);
  features.push({
    type: "Feature",
    properties: {
      code,
      name: String(props.shapeName ?? code),
      pref: stampPref(geometry),
    },
    geometry,
  });
}
features.sort((a, b) =>
  a.properties.pref === b.properties.pref
    ? a.properties.name.localeCompare(b.properties.name)
    : a.properties.pref.localeCompare(b.properties.pref),
);

const prefCounts = new Map();
for (const f of features) {
  prefCounts.set(f.properties.pref, (prefCounts.get(f.properties.pref) ?? 0) + 1);
}
console.log(
  `stamped prefectures: centroid=${stampStats.centroid} blend=${stampStats.blend} nearest=${stampStats.nearest}; ` +
    `${prefCounts.size} prefectures covered`,
);

mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, "jp.geojson");
const json = JSON.stringify({ type: "FeatureCollection", features });
writeFileSync(file, json);
console.log(
  `JP: ${features.length} municipalities -> ${path.relative(rootDir, file)} (${(json.length / 1024 / 1024).toFixed(2)} MB)`,
);

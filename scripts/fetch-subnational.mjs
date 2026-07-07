// Fetches Natural Earth 10m admin-1 states/provinces (public domain) and
// vendors slimmed per-country FeatureCollections into
// src/components/map/subnational/<cc>.geojson for the world-wide sub-national
// drill-down (the generic sibling of japanPrefectures.geojson).
//
// Each feature's properties are stripped to { code, name, name_local } and
// coordinates rounded to 3 decimals (~110 m) — precision the drill-down map
// can't show anyway, for a fraction of the bytes. Safe to re-run; a failed
// fetch leaves any existing vendored files untouched and exits 0 so builds
// keep working offline.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "src", "components", "map", "subnational");

// Countries to vendor (ISO 3166-1 alpha-2). Extend this list and re-run to
// add more drill-downs — then register the new code in
// src/components/map/subnational/registry.ts so the UI picks it up.
const COUNTRIES = ["US", "KR"];

// Tried in order. jsDelivr caps served files around 20 MB and this dataset is
// larger, so the raw GitHub mirror is the usual winner — jsDelivr stays first
// anyway for the day the dataset slims down or a cached copy exists.
const SOURCES = [
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
];

const round = (v) => Math.round(v * 1000) / 1000;

/** Rounds a ring's coordinates, dropping segments that rounding collapsed and
 *  re-closing the ring; null when fewer than a triangle survives. */
function slimRing(ring) {
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

/** Polygon coordinates with every ring slimmed; null when the outer ring degenerates. */
function slimPolygon(coords) {
  const outer = slimRing(coords[0] ?? []);
  if (!outer) return null;
  const rings = [outer];
  for (const hole of coords.slice(1)) {
    const r = slimRing(hole);
    if (r) rings.push(r);
  }
  return rings;
}

function slimGeometry(geometry) {
  if (geometry?.type === "Polygon") {
    const coords = slimPolygon(geometry.coordinates);
    return coords ? { type: "Polygon", coordinates: coords } : null;
  }
  if (geometry?.type === "MultiPolygon") {
    const polys = [];
    for (const poly of geometry.coordinates) {
      const p = slimPolygon(poly);
      if (p) polys.push(p);
    }
    if (polys.length === 0) return null;
    // a MultiPolygon whose islets all rounded away collapses to a plain Polygon
    return polys.length === 1
      ? { type: "Polygon", coordinates: polys[0] }
      : { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

/** One country's admin-1 features, slimmed and sorted by code. Membership is
 *  checked against both iso_a2 and the iso_3166_2 prefix — Natural Earth
 *  leaves iso_a2 as "-1" on a handful of features. */
function extractCountry(features, cc) {
  const out = [];
  const seen = new Set();
  for (const f of features) {
    const props = f.properties ?? {};
    // NE marks unresolved 3166-2 codes with "~"/"?" placeholders — strip them
    const iso31662 = String(props.iso_3166_2 ?? "").replace(/[^A-Za-z0-9-]/g, "");
    const belongs = String(props.iso_a2 ?? "").toUpperCase() === cc || iso31662.startsWith(`${cc}-`);
    if (!belongs) continue;
    const geometry = slimGeometry(f.geometry);
    if (!geometry) continue;
    let code = /^[A-Z]{2}-.+/.test(iso31662)
      ? iso31662
      : `${cc}-${String(props.postal || props.adm1_code || out.length + 1)}`;
    while (seen.has(code)) code = `${code}x`; // NE occasionally dupes a code; keep both addressable
    seen.add(code);
    out.push({
      type: "Feature",
      properties: {
        code,
        name: String(props.name || props.name_en || code),
        name_local: String(props.name_local ?? "") === "null" ? "" : String(props.name_local ?? ""),
      },
      geometry,
    });
  }
  out.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  return out;
}

async function loadDataset() {
  for (const url of SOURCES) {
    try {
      console.log(`fetching ${url} ...`);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.features)) throw new Error("unexpected payload (no features array)");
      console.log(`source OK (${data.features.length} admin-1 features): ${url}`);
      return data;
    } catch (err) {
      console.warn(`source failed: ${url} — ${err?.message ?? err}`);
    }
  }
  return null;
}

const dataset = await loadDataset();
if (!dataset) {
  console.log(
    "All Natural Earth sources unreachable (offline?). Nothing written — the app builds and runs " +
      "without vendored sub-national data; re-run `npm run fetch-subnational` when back online.",
  );
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
for (const cc of COUNTRIES) {
  const features = extractCountry(dataset.features, cc);
  if (features.length === 0) {
    console.warn(`${cc}: no admin-1 features matched — skipped`);
    continue;
  }
  const file = path.join(outDir, `${cc.toLowerCase()}.geojson`);
  const json = JSON.stringify({ type: "FeatureCollection", features });
  writeFileSync(file, json);
  console.log(`${cc}: ${features.length} subdivisions -> ${path.relative(rootDir, file)} (${Math.round(json.length / 1024)} KB)`);
}

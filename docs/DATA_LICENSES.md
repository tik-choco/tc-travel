# Map Data Licenses

tc-travel vendors all of its map data into the repository (no runtime fetches),
so the licenses of those datasets travel with the code. This file is the
canonical record; keep it in sync when `scripts/fetch-*.mjs` gains a source.

## Municipality boundaries (Japan, 市区町村 / admin-2)

- **File:** `src/components/map/municipal/jp.geojson`
- **Source:** [geoBoundaries](https://www.geoboundaries.org/) JPN ADM2
  (gbOpen release, simplified), fetched by `scripts/fetch-municipalities.mjs`
- **Upstream data:** © OpenStreetMap contributors
- **License:** CC BY-SA 2.0 (attribution + share-alike)
- **Obligations:**
  - Credit is shown in-app wherever the municipality tier renders
    (the `map.muni.credit` line: "市区町村境界: © OpenStreetMap contributors ·
    geoBoundaries (CC BY-SA)").
  - Modified versions of the data (we simplify geometry, strip properties and
    stamp prefecture codes) must remain available under the same license —
    the vendored `jp.geojson` in this MPL-2.0 repository satisfies that; do
    not relicense or obfuscate it.
  - No usage reporting is required.
- **Citation:** Runfola, D. et al. (2020) geoBoundaries: A global database of
  political administrative boundaries. PLoS ONE 15(4): e0231866.

## Country + state/province boundaries (world, admin-0 / admin-1)

- **Files:** `src/components/map/japanPrefectures.geojson`,
  `src/components/map/subnational/*.geojson`
  (fetched by `scripts/fetch-subnational.mjs`), plus the `world-atlas` npm
  package (admin-0, derived from the same source)
- **Source:** [Natural Earth](https://www.naturalearthdata.com/) (10m admin-1,
  110m/50m admin-0)
- **License:** Public domain — no attribution required (credit given anyway
  in source comments).

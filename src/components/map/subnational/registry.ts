// Which countries have a sub-national drill-down, and of what kind. The world
// map asks this registry instead of knowing about individual maps:
//   - "japan"   → mount the existing JapanMap (the original, with its curated
//                 regions/rarity/badges collection layer — not reimplemented here)
//   - "generic" → mount SubnationalMap, fed by admin1Resolver.ts's chain:
//                 vendored Natural Earth data (us/kr, scripts/fetch-subnational.mjs)
//                 when it shipped, else a dynamic geoBoundaries fetch cached in
//                 IndexedDB. That chain covers EVERY country, so every visited
//                 country is now potentially drill-downable, not just us/kr.
// hasData only describes the FAST, synchronous path (vendored data actually in
// the bundle) — it's informational, not a gate: SubnationalMap itself renders
// a graceful "no data" state when the dynamic resolver comes back empty
// (offline, or a country with no ADM1 layer at geoBoundaries at all).
import { AVAILABLE_GEO_CODES } from "./subnationalGeo";
import { KNOWN_ALPHA2 } from "../../../lib/geo/iso3";
import "./subnational.i18n";

export type SubnationalKind = "japan" | "generic";

export interface SubnationalEntry {
  /** ISO 3166-1 alpha-2, lowercase — the world map's country code space */
  code: string;
  kind: SubnationalKind;
  /** true when this country has a FAST, synchronous data source (jp's bespoke
   *  map, or us/kr's vendored geojson) — informational only, see module doc. */
  hasData: boolean;
  /** i18n key for a curated display name (registered in subnational.i18n.ts);
   *  unset for dynamically-resolved countries, which fall back to
   *  geo.ts's countryName() instead. */
  displayNameKey?: string;
}

/** Curated generic drill-down countries with a vendored fast path — extend
 *  alongside COUNTRIES in scripts/fetch-subnational.mjs (plus a display-name
 *  entry in subnational.i18n.ts) when vendoring a new one. Every OTHER country
 *  still drills down; it just resolves dynamically (admin1Resolver.ts) and
 *  displays via countryName() instead of a curated translation. */
const GENERIC_COUNTRY_CODES = ["us", "kr"] as const;

/** Curated entries only: jp (bespoke map) plus the countries with a vendored
 *  fast path and a translated display name. Most UI code should call
 *  subnationalEntry() instead, which also covers every other country. */
export const SUBNATIONAL_REGISTRY: ReadonlyMap<string, SubnationalEntry> = new Map<
  string,
  SubnationalEntry
>([
  // Japan ships its own hand-tuned map + geojson; always available.
  ["jp", { code: "jp", kind: "japan", hasData: true, displayNameKey: "map.sub.country.jp" }],
  ...GENERIC_COUNTRY_CODES.map((code): [string, SubnationalEntry] => [
    code,
    {
      code,
      kind: "generic",
      hasData: AVAILABLE_GEO_CODES.has(code),
      displayNameKey: `map.sub.country.${code}`,
    },
  ]),
]);

/** Registry lookup, tolerant of uppercase codes. Always returns an entry: a
 *  curated one for jp/us/kr, or a synthesized "generic" one for every other
 *  country — SubnationalMap + admin1Resolver.ts handle those dynamically. */
export function subnationalEntry(countryCode: string): SubnationalEntry {
  const cc = countryCode.toLowerCase();
  return SUBNATIONAL_REGISTRY.get(cc) ?? { code: cc, kind: "generic", hasData: true };
}

/** Codes worth offering a "drill in" affordance for on the world map / globe —
 *  every country the admin-1 resolver could possibly resolve (it needs an ISO
 *  alpha-3 to build the geoBoundaries URL; jp/us/kr are included here too). */
export const SUBNATIONAL_COUNTRY_CODES: readonly string[] = KNOWN_ALPHA2;

// Which countries have a sub-national drill-down, and of what kind. The world
// map asks this registry instead of knowing about individual maps:
//   - "japan"   → mount the existing JapanMap (the original, with its curated
//                 regions/rarity/badges collection layer — not reimplemented here)
//   - "generic" → mount SubnationalMap, fed by vendored Natural Earth admin-1
//                 data (scripts/fetch-subnational.mjs)
// hasData gates on the vendored geojson actually existing, so the app
// compiles and runs whether or not the fetch ever succeeded.
import { AVAILABLE_GEO_CODES } from "./subnationalGeo";
import "./subnational.i18n";

export type SubnationalKind = "japan" | "generic";

export interface SubnationalEntry {
  /** ISO 3166-1 alpha-2, lowercase — the world map's country code space */
  code: string;
  kind: SubnationalKind;
  /** true when the drill-down actually has geometry to show */
  hasData: boolean;
  /** i18n key for the country's display name (registered in subnational.i18n.ts) */
  displayNameKey: string;
}

/** Curated generic drill-down countries — extend alongside COUNTRIES in
 *  scripts/fetch-subnational.mjs (plus a display-name entry in
 *  subnational.i18n.ts) when vendoring a new country. */
const GENERIC_COUNTRY_CODES = ["us", "kr"] as const;

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

/** Registry lookup, tolerant of uppercase codes; undefined → no drill-down. */
export function subnationalEntry(countryCode: string): SubnationalEntry | undefined {
  return SUBNATIONAL_REGISTRY.get(countryCode.toLowerCase());
}

/** Codes whose drill-down is actually openable right now — what the world map
 *  should show a "drill in" affordance for on a visited country. */
export const SUBNATIONAL_COUNTRY_CODES: readonly string[] = [...SUBNATIONAL_REGISTRY.values()]
  .filter((e) => e.hasData)
  .map((e) => e.code);

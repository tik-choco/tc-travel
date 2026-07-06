// Pure collection/gamification helpers for the Japan prefecture drill-down:
// completion stats, per-prefecture rarity tiers, traditional-region groupings
// and achievement badges. Deliberately geometry-free and I/O-free so the whole
// reward loop is unit-testable in isolation (see __tests__/collection.test.ts).
//
// Prefectures are identified by ISO 3166-2 codes ("JP-01".."JP-47"), the same
// codes japanPrefectures.geojson carries in `properties.code`.

export const JP_TOTAL = 47;

// --- traditional regions ---------------------------------------------------

/** The eight traditional regions, with Okinawa split from Kyushu (as most
 *  Japanese maps and the geojson's island layout do). */
export type RegionId =
  | "hokkaido"
  | "tohoku"
  | "kanto"
  | "chubu"
  | "kinki"
  | "chugoku"
  | "shikoku"
  | "kyushu"
  | "okinawa";

export const REGION_ORDER: readonly RegionId[] = [
  "hokkaido",
  "tohoku",
  "kanto",
  "chubu",
  "kinki",
  "chugoku",
  "shikoku",
  "kyushu",
  "okinawa",
];

export const REGIONS: Record<RegionId, readonly string[]> = {
  hokkaido: ["JP-01"],
  tohoku: ["JP-02", "JP-03", "JP-04", "JP-05", "JP-06", "JP-07"],
  kanto: ["JP-08", "JP-09", "JP-10", "JP-11", "JP-12", "JP-13", "JP-14"],
  chubu: ["JP-15", "JP-16", "JP-17", "JP-18", "JP-19", "JP-20", "JP-21", "JP-22", "JP-23"],
  kinki: ["JP-24", "JP-25", "JP-26", "JP-27", "JP-28", "JP-29", "JP-30"],
  chugoku: ["JP-31", "JP-32", "JP-33", "JP-34", "JP-35"],
  shikoku: ["JP-36", "JP-37", "JP-38", "JP-39"],
  kyushu: ["JP-40", "JP-41", "JP-42", "JP-43", "JP-44", "JP-45", "JP-46"],
  okinawa: ["JP-47"],
};

/** Every prefecture code exactly once, in JP-01..JP-47 order. */
export const ALL_PREFECTURE_CODES: readonly string[] = REGION_ORDER.flatMap((r) => REGIONS[r]);

// --- completion ------------------------------------------------------------

export interface CompletionStats {
  /** prefectures visited (only counts real JP-* codes, so stray input can't inflate it) */
  count: number;
  total: number;
  /** rounded percentage for display */
  pct: number;
  /** unrounded percentage, for progress bars where 1/47 must still move the needle */
  exactPct: number;
}

export function completionStats(visited: ReadonlySet<string>): CompletionStats {
  let count = 0;
  for (const code of ALL_PREFECTURE_CODES) if (visited.has(code)) count++;
  const exactPct = (count / JP_TOTAL) * 100;
  return { count, total: JP_TOTAL, pct: Math.round(exactPct), exactPct };
}

export interface RegionStat {
  id: RegionId;
  count: number;
  total: number;
}

/** Per-region completion in REGION_ORDER — the drill-down's answer to the world map's continent chips. */
export function regionStats(visited: ReadonlySet<string>): RegionStat[] {
  return REGION_ORDER.map((id) => ({
    id,
    count: REGIONS[id].filter((c) => visited.has(c)).length,
    total: REGIONS[id].length,
  }));
}

// --- rarity ----------------------------------------------------------------

export type RarityTier = "common" | "uncommon" | "rare" | "legendary";

// Heuristic, not science: tiers loosely follow domestic/inbound visitor
// volume and how far off the standard travel corridors a prefecture sits.
// "common" = hub prefectures nearly every trip passes through (Golden Route,
// gateway airports); "legendary" = the famously least-visited, hardest-to-
// justify detours (San'in coast, rural Shikoku, deep Tohoku). Everything not
// listed defaults to "uncommon". Ticking off a legendary prefecture is the
// collection's flex — see the "hidden-gem" badge below.
const RARITY_OVERRIDES: Record<string, RarityTier> = {
  // hubs & Golden Route
  "JP-01": "common", // Hokkaido
  "JP-11": "common", // Saitama
  "JP-12": "common", // Chiba (Narita)
  "JP-13": "common", // Tokyo
  "JP-14": "common", // Kanagawa
  "JP-22": "common", // Shizuoka (Tokaido corridor)
  "JP-23": "common", // Aichi
  "JP-26": "common", // Kyoto
  "JP-27": "common", // Osaka
  "JP-28": "common", // Hyogo
  "JP-29": "common", // Nara
  "JP-34": "common", // Hiroshima
  "JP-40": "common", // Fukuoka
  "JP-47": "common", // Okinawa
  // well off the corridors
  "JP-02": "rare", // Aomori
  "JP-03": "rare", // Iwate
  "JP-06": "rare", // Yamagata
  "JP-18": "rare", // Fukui
  "JP-30": "rare", // Wakayama
  "JP-36": "rare", // Tokushima
  "JP-41": "rare", // Saga
  "JP-45": "rare", // Miyazaki
  // the famous four least-visited
  "JP-05": "legendary", // Akita
  "JP-31": "legendary", // Tottori
  "JP-32": "legendary", // Shimane
  "JP-39": "legendary", // Kochi
};

export function rarityOf(code: string): RarityTier {
  return RARITY_OVERRIDES[code] ?? "uncommon";
}

/** Codes of every legendary-tier prefecture (drives the "hidden-gem" badge). */
export const LEGENDARY_CODES: readonly string[] = ALL_PREFECTURE_CODES.filter(
  (c) => rarityOf(c) === "legendary",
);

// --- achievement badges ------------------------------------------------------

export interface BadgeDef {
  /** i18n suffix: `map.jp.badge.<id>`; region badges use `region-<RegionId>` + the fn entry `map.jp.badge.region`. */
  id: string;
  test: (visited: ReadonlySet<string>) => boolean;
}

const countOf = (visited: ReadonlySet<string>) => completionStats(visited).count;

/** All badges, most prestigious first — earnedBadges() preserves this order,
 *  so "top badges" for the brag card is just a slice(0, n). */
export const BADGES: readonly BadgeDef[] = [
  { id: "complete", test: (v) => countOf(v) === JP_TOTAL },
  ...REGION_ORDER.map(
    (r): BadgeDef => ({ id: `region-${r}`, test: (v) => REGIONS[r].every((c) => v.has(c)) }),
  ),
  { id: "forty", test: (v) => countOf(v) >= 40 },
  { id: "half", test: (v) => countOf(v) >= 24 },
  { id: "ten", test: (v) => countOf(v) >= 10 },
  { id: "hidden-gem", test: (v) => LEGENDARY_CODES.some((c) => v.has(c)) },
  { id: "first-step", test: (v) => countOf(v) >= 1 },
];

export function earnedBadges(visited: ReadonlySet<string>): string[] {
  return BADGES.filter((b) => b.test(visited)).map((b) => b.id);
}

/** Resolves a badge id to display text; t is injected so this stays pure. */
export function badgeLabel(
  id: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const REGION_PREFIX = "region-";
  return id.startsWith(REGION_PREFIX)
    ? t("map.jp.badge.region", { region: t(`map.jp.region.${id.slice(REGION_PREFIX.length)}`) })
    : t(`map.jp.badge.${id}`);
}

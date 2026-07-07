// XP/level/achievement derivation. Pure functions only (no localStorage, no
// Y.Doc access) — everything here is computed from a JourneyStats snapshot
// so achievements/rank can never desync from the underlying data (see
// docs/DESIGN.md's "Everything is derived, no separate gamification state
// to corrupt").
import type { AchievementDef, JourneyStats, RankInfo } from "./types";

// --- continent lookup (for the continental-spread achievements) -----------
// ISO 3166-1 alpha-2 -> continent short code (AF Africa, AM Americas, AS
// Asia, EU Europe, OC Oceania, AN Antarctica). Sourced from the same
// authoritative ISO 3166 region data as geo.ts's numeric table, so every
// code geo.ts can ever produce resolves to a continent here too.
const CONTINENT_BY_ALPHA2: Record<string, string> = {
  ad: "EU", ae: "AS", af: "AS", ag: "AM", ai: "AM", al: "EU", am: "AS", ao: "AF", aq: "AN", ar: "AM",
  as: "OC", at: "EU", au: "OC", aw: "AM", ax: "EU", az: "AS", ba: "EU", bb: "AM", bd: "AS", be: "EU",
  bf: "AF", bg: "EU", bh: "AS", bi: "AF", bj: "AF", bl: "AM", bm: "AM", bn: "AS", bo: "AM", bq: "AM",
  br: "AM", bs: "AM", bt: "AS", bv: "AM", bw: "AF", by: "EU", bz: "AM", ca: "AM", cc: "OC", cd: "AF",
  cf: "AF", cg: "AF", ch: "EU", ci: "AF", ck: "OC", cl: "AM", cm: "AF", cn: "AS", co: "AM", cr: "AM",
  cu: "AM", cv: "AF", cw: "AM", cx: "OC", cy: "AS", cz: "EU", de: "EU", dj: "AF", dk: "EU", dm: "AM",
  do: "AM", dz: "AF", ec: "AM", ee: "EU", eg: "AF", eh: "AF", er: "AF", es: "EU", et: "AF", fi: "EU",
  fj: "OC", fk: "AM", fm: "OC", fo: "EU", fr: "EU", ga: "AF", gb: "EU", gd: "AM", ge: "AS", gf: "AM",
  gg: "EU", gh: "AF", gi: "EU", gl: "AM", gm: "AF", gn: "AF", gp: "AM", gq: "AF", gr: "EU", gs: "AM",
  gt: "AM", gu: "OC", gw: "AF", gy: "AM", hk: "AS", hm: "OC", hn: "AM", hr: "EU", ht: "AM", hu: "EU",
  id: "AS", ie: "EU", il: "AS", im: "EU", in: "AS", io: "AF", iq: "AS", ir: "AS", is: "EU", it: "EU",
  je: "EU", jm: "AM", jo: "AS", jp: "AS", ke: "AF", kg: "AS", kh: "AS", ki: "OC", km: "AF", kn: "AM",
  kp: "AS", kr: "AS", kw: "AS", ky: "AM", kz: "AS", la: "AS", lb: "AS", lc: "AM", li: "EU", lk: "AS",
  lr: "AF", ls: "AF", lt: "EU", lu: "EU", lv: "EU", ly: "AF", ma: "AF", mc: "EU", md: "EU", me: "EU",
  mf: "AM", mg: "AF", mh: "OC", mk: "EU", ml: "AF", mm: "AS", mn: "AS", mo: "AS", mp: "OC", mq: "AM",
  mr: "AF", ms: "AM", mt: "EU", mu: "AF", mv: "AS", mw: "AF", mx: "AM", my: "AS", mz: "AF", na: "AF",
  nc: "OC", ne: "AF", nf: "OC", ng: "AF", ni: "AM", nl: "EU", no: "EU", np: "AS", nr: "OC", nu: "OC",
  nz: "OC", om: "AS", pa: "AM", pe: "AM", pf: "OC", pg: "OC", ph: "AS", pk: "AS", pl: "EU", pm: "AM",
  pn: "OC", pr: "AM", ps: "AS", pt: "EU", pw: "OC", py: "AM", qa: "AS", re: "AF", ro: "EU", rs: "EU",
  ru: "EU", rw: "AF", sa: "AS", sb: "OC", sc: "AF", sd: "AF", se: "EU", sg: "AS", sh: "AF", si: "EU",
  sj: "EU", sk: "EU", sl: "AF", sm: "EU", sn: "AF", so: "AF", sr: "AM", ss: "AF", st: "AF", sv: "AM",
  sx: "AM", sy: "AS", sz: "AF", tc: "AM", td: "AF", tf: "AF", tg: "AF", th: "AS", tj: "AS", tk: "OC",
  tl: "AS", tm: "AS", tn: "AF", to: "OC", tr: "AS", tt: "AM", tv: "OC", tw: "AS", tz: "AF", ua: "EU",
  ug: "AF", um: "OC", us: "AM", uy: "AM", uz: "AS", va: "EU", vc: "AM", ve: "AM", vg: "AM", vi: "AM",
  vn: "AS", vu: "OC", wf: "OC", ws: "OC", ye: "AS", yt: "AF", za: "AF", zm: "AF", zw: "AF",
  xk: "EU", // Kosovo (geo.ts name-override code, not an official ISO alpha-2)
};

function continentsVisited(stats: JourneyStats): Set<string> {
  const set = new Set<string>();
  for (const code of stats.countriesVisited) {
    const continent = CONTINENT_BY_ALPHA2[code];
    if (continent) set.add(continent);
  }
  return set;
}

// world-atlas's countries-110m ships 177 land territories — the full set an
// encounter pin/photo/diary entry could ever reveal on the fog-of-war map.
const TOTAL_ATLAS_COUNTRIES = 177;

// --- stats ------------------------------------------------------------

type JourneySnapshot = {
  pins: { countryCode: string; companions: string[] }[];
  photos: { geo: { countryCode: string } | null; arShot: boolean }[];
  diary: { geo: { countryCode: string } | null }[];
  streakDays: number;
  roomCount: number;
  /** cards collected face-to-face (lib/cards.ts) — real-world meetings */
  cardsCollected?: number;
  /** distinct JP prefectures visited (japanGeo.visitedPrefectures) — the
   *  Japan drill-down feeds the main economy through this. Optional because
   *  the geometry loads lazily; treated as 0 until resolved. */
  prefecturesVisited?: number;
};

export function computeStats(j: JourneySnapshot): JourneyStats {
  const countries = new Set<string>();
  for (const pin of j.pins) if (pin.countryCode) countries.add(pin.countryCode);
  for (const photo of j.photos) if (photo.geo?.countryCode) countries.add(photo.geo.countryCode);
  for (const entry of j.diary) if (entry.geo?.countryCode) countries.add(entry.geo.countryCode);

  const companions = new Set<string>();
  for (const pin of j.pins) {
    for (const name of pin.companions) {
      const trimmed = name.trim();
      if (trimmed) companions.add(trimmed);
    }
  }

  return {
    countriesVisited: Array.from(countries),
    companionsMet: Array.from(companions),
    photoCount: j.photos.length,
    arPhotoCount: j.photos.filter((p) => p.arShot).length,
    diaryCount: j.diary.length,
    pinCount: j.pins.length,
    roomCount: j.roomCount,
    streakDays: j.streakDays,
    cardsCollected: j.cardsCollected ?? 0,
    prefecturesVisited: j.prefecturesVisited ?? 0,
  };
}

// --- XP / rank --------------------------------------------------------

const XP = {
  country: 100,
  card: 50, // meeting someone face-to-face is a real, deliberate act — weight it above a pin
  companion: 40,
  prefecture: 25, // collection depth: filling Japan meaningfully moves the economy
  pin: 20,
  arPhoto: 15,
  diary: 10,
  photo: 5,
  streakDay: 5,
} as const;

function computeXp(stats: JourneyStats): number {
  // arPhotoCount is a subset of photoCount (an AR shot is still a photo),
  // so the plain "photo" weight only applies to the non-AR remainder —
  // otherwise every AR photo would double-count.
  const plainPhotoCount = Math.max(0, stats.photoCount - stats.arPhotoCount);
  return (
    stats.countriesVisited.length * XP.country +
    stats.cardsCollected * XP.card +
    stats.companionsMet.length * XP.companion +
    stats.prefecturesVisited * XP.prefecture +
    stats.pinCount * XP.pin +
    stats.arPhotoCount * XP.arPhoto +
    plainPhotoCount * XP.photo +
    stats.diaryCount * XP.diary +
    stats.streakDays * XP.streakDay
  );
}

/** Cumulative XP required to *reach* level n (n=0 => 0). Triangular-number growth, scaled by 100. */
export function xpForLevel(n: number): number {
  return (100 * n * (n + 1)) / 2;
}

function rankTitleKey(level: number): string {
  if (level <= 2) return "rank.wanderer";
  if (level <= 5) return "rank.pathfinder";
  if (level <= 9) return "rank.voyager";
  if (level <= 14) return "rank.cartographer";
  return "rank.legend";
}

export function computeRank(stats: JourneyStats): RankInfo {
  const xp = computeXp(stats);
  let level = 1;
  while (xp >= xpForLevel(level)) level++;
  const xpIntoLevel = xp - xpForLevel(level - 1);
  const xpForNextLevel = xpForLevel(level) - xpForLevel(level - 1);
  return { level, xp, xpIntoLevel, xpForNextLevel, titleKey: rankTitleKey(level) };
}

// --- achievements -----------------------------------------------------

// A countable achievement: `need` is the threshold, `have` reads the tracked
// stat. `achieved`/`progress` are both derived from these so a tile's meter and
// its unlocked state can never disagree.
function counted(
  id: string,
  icon: string,
  need: number,
  have: (s: JourneyStats) => number,
): AchievementDef {
  return {
    id,
    titleKey: `ach.${id}.title`,
    descKey: `ach.${id}.desc`,
    icon,
    achieved: (s) => have(s) >= need,
    progress: (s) => ({ have: Math.min(have(s), need), need }),
  };
}

const countries = (s: JourneyStats) => s.countriesVisited.length;
const continents = (s: JourneyStats) => continentsVisited(s).size;
const companions = (s: JourneyStats) => s.companionsMet.length;

// Ordered roughly by the journey they trace: first touches, meeting people,
// spreading across the map, filling Japan, keeping the habit. earnedBadges and
// the achievements grid both preserve this order.
export const ACHIEVEMENTS: AchievementDef[] = [
  counted("firstSteps", "\u{1F463}", 1, (s) => s.pinCount + s.photoCount + s.diaryCount),
  // meeting people — cards are real-world proof, companions are pin free-text
  counted("namecard1", "\u{1FAAA}", 1, (s) => s.cardsCollected),
  counted("namecard10", "\u{1F4C7}", 10, (s) => s.cardsCollected),
  counted("fellowship5", "\u{1F91D}", 5, companions),
  counted("socialButterfly10", "\u{1F98B}", 10, companions),
  // spreading across the world
  counted("continental3", "\u{1F30D}", 3, continents),
  counted("worldTraveler5", "✈️", 5, continents),
  counted("worldTraveler6", "\u{1F9F3}", 6, continents),
  counted("cartographer10", "\u{1F5FA}️", 10, countries),
  counted("explorer25", "\u{1F9ED}", 25, countries),
  counted("globetrotter50", "\u{1F310}", 50, countries),
  counted("halfWorldExplored", "\u{1FA99}", Math.ceil(TOTAL_ATLAS_COUNTRIES / 2), countries),
  // filling Japan — the prefecture drill-down feeds the main economy here
  counted("japan10", "\u{1F5FE}", 10, (s) => s.prefecturesVisited),
  counted("japanHalf", "⛩️", 24, (s) => s.prefecturesVisited),
  counted("japanComplete", "\u{1F38C}", 47, (s) => s.prefecturesVisited),
  // keeping the journal & the habit
  counted("chronicler10", "\u{1F4D6}", 10, (s) => s.diaryCount),
  counted("chronicler30", "\u{1F4DA}", 30, (s) => s.diaryCount),
  counted("pinDropper10", "\u{1F4CD}", 10, (s) => s.pinCount),
  counted("photographer25", "\u{1F4F8}", 25, (s) => s.photoCount),
  {
    id: "portraitOfLegends",
    titleKey: "ach.portraitOfLegends.title",
    descKey: "ach.portraitOfLegends.desc",
    icon: "\u{1F5BC}️",
    achieved: (s) => s.arPhotoCount >= 1,
  },
  counted("legendaryLens5", "✨", 5, (s) => s.arPhotoCount),
  counted("weekStreak", "\u{1F525}", 7, (s) => s.streakDays),
  counted("monthStreak", "\u{1F31F}", 30, (s) => s.streakDays),
  counted("guildVeteran5", "\u{1F3D5}️", 5, (s) => s.roomCount),
];

/** The nearest unmet goal — the achievement whose remaining count is smallest,
 *  for a "you're N away from X" nudge on Home and the Guild card. Streak
 *  achievements are excluded: "come back N more days" isn't an action the user
 *  can take right now, so it makes a poor call-to-action. Returns null once
 *  every non-streak achievement is unlocked. */
export function nextGoal(
  stats: JourneyStats,
): { def: AchievementDef; have: number; need: number; remaining: number } | null {
  const STREAK_IDS = new Set(["weekStreak", "monthStreak"]);
  let best: { def: AchievementDef; have: number; need: number; remaining: number } | null = null;
  for (const def of ACHIEVEMENTS) {
    if (!def.progress || STREAK_IDS.has(def.id) || def.achieved(stats)) continue;
    const { have, need } = def.progress(stats);
    const remaining = need - have;
    if (remaining <= 0) continue;
    if (!best || remaining < best.remaining) best = { def, have, need, remaining };
  }
  return best;
}

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
  };
}

// --- XP / rank --------------------------------------------------------

const XP = {
  country: 100,
  companion: 40,
  pin: 20,
  arPhoto: 15,
  photo: 5,
  diary: 10,
  streakDay: 5,
} as const;

function computeXp(stats: JourneyStats): number {
  // arPhotoCount is a subset of photoCount (an AR shot is still a photo),
  // so the plain "photo" weight only applies to the non-AR remainder —
  // otherwise every AR photo would double-count.
  const plainPhotoCount = Math.max(0, stats.photoCount - stats.arPhotoCount);
  return (
    stats.countriesVisited.length * XP.country +
    stats.companionsMet.length * XP.companion +
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

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "firstSteps",
    titleKey: "ach.firstSteps.title",
    descKey: "ach.firstSteps.desc",
    icon: "\u{1F463}",
    achieved: (s) => s.pinCount + s.photoCount + s.diaryCount >= 1,
  },
  {
    id: "fellowship5",
    titleKey: "ach.fellowship5.title",
    descKey: "ach.fellowship5.desc",
    icon: "\u{1F91D}",
    achieved: (s) => s.companionsMet.length >= 5,
  },
  {
    id: "socialButterfly10",
    titleKey: "ach.socialButterfly10.title",
    descKey: "ach.socialButterfly10.desc",
    icon: "\u{1F98B}",
    achieved: (s) => s.companionsMet.length >= 10,
  },
  {
    id: "continental3",
    titleKey: "ach.continental3.title",
    descKey: "ach.continental3.desc",
    icon: "\u{1F30D}",
    achieved: (s) => continentsVisited(s).size >= 3,
  },
  {
    id: "worldTraveler5",
    titleKey: "ach.worldTraveler5.title",
    descKey: "ach.worldTraveler5.desc",
    icon: "✈️",
    achieved: (s) => continentsVisited(s).size >= 5,
  },
  {
    id: "cartographer10",
    titleKey: "ach.cartographer10.title",
    descKey: "ach.cartographer10.desc",
    icon: "\u{1F5FA}️",
    achieved: (s) => s.countriesVisited.length >= 10,
  },
  {
    id: "halfWorldExplored",
    titleKey: "ach.halfWorldExplored.title",
    descKey: "ach.halfWorldExplored.desc",
    icon: "\u{1FA99}",
    achieved: (s) => s.countriesVisited.length >= Math.ceil(TOTAL_ATLAS_COUNTRIES / 2),
  },
  {
    id: "chronicler10",
    titleKey: "ach.chronicler10.title",
    descKey: "ach.chronicler10.desc",
    icon: "\u{1F4D6}",
    achieved: (s) => s.diaryCount >= 10,
  },
  {
    id: "pinDropper10",
    titleKey: "ach.pinDropper10.title",
    descKey: "ach.pinDropper10.desc",
    icon: "\u{1F4CD}",
    achieved: (s) => s.pinCount >= 10,
  },
  {
    id: "photographer25",
    titleKey: "ach.photographer25.title",
    descKey: "ach.photographer25.desc",
    icon: "\u{1F4F8}",
    achieved: (s) => s.photoCount >= 25,
  },
  {
    id: "portraitOfLegends",
    titleKey: "ach.portraitOfLegends.title",
    descKey: "ach.portraitOfLegends.desc",
    icon: "\u{1F5BC}️",
    achieved: (s) => s.arPhotoCount >= 1,
  },
  {
    id: "legendaryLens5",
    titleKey: "ach.legendaryLens5.title",
    descKey: "ach.legendaryLens5.desc",
    icon: "✨",
    achieved: (s) => s.arPhotoCount >= 5,
  },
  {
    id: "weekStreak",
    titleKey: "ach.weekStreak.title",
    descKey: "ach.weekStreak.desc",
    icon: "\u{1F525}",
    achieved: (s) => s.streakDays >= 7,
  },
  {
    id: "monthStreak",
    titleKey: "ach.monthStreak.title",
    descKey: "ach.monthStreak.desc",
    icon: "\u{1F31F}",
    achieved: (s) => s.streakDays >= 30,
  },
  {
    id: "guildVeteran5",
    titleKey: "ach.guildVeteran5.title",
    descKey: "ach.guildVeteran5.desc",
    icon: "\u{1F3D5}️",
    achieved: (s) => s.roomCount >= 5,
  },
];

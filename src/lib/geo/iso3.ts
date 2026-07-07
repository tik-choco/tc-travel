// ISO 3166-1 alpha-2 ⇄ alpha-3 mapping.
//
// geoBoundaries keys every file and API path by ISO3 (e.g. .../gbOpen/JPN/ADM2/),
// while the rest of tc-travel speaks alpha-2 lowercase (GeoPoint.countryCode,
// lookupCountry, etc.). The municipal resolver needs the alpha-3 to build a
// country's admin-2 download URL, so this small vendored table bridges the two.
//
// Coverage mirrors geo.ts's NUMERIC_TO_ALPHA2 (every country the world-atlas
// data can resolve, cross-checked against the full ISO 3166 standard) plus the
// three atlas territories geo.ts name-overrides (Kosovo → XKX is geoBoundaries'
// own code for it). Purely static data — no IO, so it stays trivially testable.

/** ISO 3166-1 alpha-2 (lowercase) → alpha-3 (UPPERCASE). */
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  af: "AFG", al: "ALB", aq: "ATA", dz: "DZA", as: "ASM", ad: "AND", ao: "AGO", ag: "ATG",
  az: "AZE", ar: "ARG", au: "AUS", at: "AUT", bs: "BHS", bh: "BHR", bd: "BGD", am: "ARM",
  bb: "BRB", be: "BEL", bm: "BMU", bt: "BTN", bo: "BOL", ba: "BIH", bw: "BWA", bv: "BVT",
  br: "BRA", bz: "BLZ", io: "IOT", sb: "SLB", vg: "VGB", bn: "BRN", bg: "BGR", mm: "MMR",
  bi: "BDI", by: "BLR", kh: "KHM", cm: "CMR", ca: "CAN", cv: "CPV", ky: "CYM", cf: "CAF",
  lk: "LKA", td: "TCD", cl: "CHL", cn: "CHN", tw: "TWN", cx: "CXR", cc: "CCK", co: "COL",
  km: "COM", yt: "MYT", cg: "COG", cd: "COD", ck: "COK", cr: "CRI", hr: "HRV", cu: "CUB",
  cy: "CYP", cz: "CZE", bj: "BEN", dk: "DNK", dm: "DMA", do: "DOM", ec: "ECU", sv: "SLV",
  gq: "GNQ", et: "ETH", er: "ERI", ee: "EST", fo: "FRO", fk: "FLK", gs: "SGS", fj: "FJI",
  fi: "FIN", ax: "ALA", fr: "FRA", gf: "GUF", pf: "PYF", tf: "ATF", dj: "DJI", ga: "GAB",
  ge: "GEO", gm: "GMB", ps: "PSE", de: "DEU", gh: "GHA", gi: "GIB", ki: "KIR", gr: "GRC",
  gl: "GRL", gd: "GRD", gp: "GLP", gu: "GUM", gt: "GTM", gn: "GIN", gy: "GUY", ht: "HTI",
  hm: "HMD", va: "VAT", hn: "HND", hk: "HKG", hu: "HUN", is: "ISL", in: "IND", id: "IDN",
  ir: "IRN", iq: "IRQ", ie: "IRL", il: "ISR", it: "ITA", ci: "CIV", jm: "JAM", jp: "JPN",
  kz: "KAZ", jo: "JOR", ke: "KEN", kp: "PRK", kr: "KOR", kw: "KWT", kg: "KGZ", la: "LAO",
  lb: "LBN", ls: "LSO", lv: "LVA", lr: "LBR", ly: "LBY", li: "LIE", lt: "LTU", lu: "LUX",
  mo: "MAC", mg: "MDG", mw: "MWI", my: "MYS", mv: "MDV", ml: "MLI", mt: "MLT", mq: "MTQ",
  mr: "MRT", mu: "MUS", mx: "MEX", mc: "MCO", mn: "MNG", md: "MDA", me: "MNE", ms: "MSR",
  ma: "MAR", mz: "MOZ", om: "OMN", na: "NAM", nr: "NRU", np: "NPL", nl: "NLD", cw: "CUW",
  aw: "ABW", sx: "SXM", bq: "BES", nc: "NCL", vu: "VUT", nz: "NZL", ni: "NIC", ne: "NER",
  ng: "NGA", nu: "NIU", nf: "NFK", no: "NOR", mp: "MNP", um: "UMI", fm: "FSM", mh: "MHL",
  pw: "PLW", pk: "PAK", pa: "PAN", pg: "PNG", py: "PRY", pe: "PER", ph: "PHL", pn: "PCN",
  pl: "POL", pt: "PRT", gw: "GNB", tl: "TLS", pr: "PRI", qa: "QAT", re: "REU", ro: "ROU",
  ru: "RUS", rw: "RWA", bl: "BLM", sh: "SHN", kn: "KNA", ai: "AIA", lc: "LCA", mf: "MAF",
  pm: "SPM", vc: "VCT", sm: "SMR", st: "STP", sa: "SAU", sn: "SEN", rs: "SRB", sc: "SYC",
  sl: "SLE", sg: "SGP", sk: "SVK", vn: "VNM", si: "SVN", so: "SOM", za: "ZAF", zw: "ZWE",
  es: "ESP", ss: "SSD", sd: "SDN", eh: "ESH", sr: "SUR", sj: "SJM", sz: "SWZ", se: "SWE",
  ch: "CHE", sy: "SYR", tj: "TJK", th: "THA", tg: "TGO", tk: "TKL", to: "TON", tt: "TTO",
  ae: "ARE", tn: "TUN", tr: "TUR", tm: "TKM", tc: "TCA", tv: "TUV", ug: "UGA", ua: "UKR",
  mk: "MKD", eg: "EGY", gb: "GBR", gg: "GGY", je: "JEY", im: "IMN", tz: "TZA", us: "USA",
  vi: "VIR", bf: "BFA", uy: "URY", uz: "UZB", ve: "VEN", wf: "WLF", ws: "WSM", ye: "YEM",
  zm: "ZMB",
  // geo.ts name-overrides for atlas territories with no numeric id. XKX is the
  // user-assigned alpha-3 geoBoundaries itself uses for Kosovo.
  xk: "XKX",
};

const ALPHA3_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  Object.entries(ALPHA2_TO_ALPHA3).map(([a2, a3]) => [a3, a2]),
);

/** ISO 3166-1 alpha-3 (uppercase) for a lowercase alpha-2 code, or "" if unmapped. */
export function alpha2ToAlpha3(alpha2: string): string {
  return ALPHA2_TO_ALPHA3[alpha2.toLowerCase()] ?? "";
}

/** ISO 3166-1 alpha-2 (lowercase) for an alpha-3 code, or "" if unmapped. */
export function alpha3ToAlpha2(alpha3: string): string {
  return ALPHA3_TO_ALPHA2[alpha3.toUpperCase()] ?? "";
}

/** Every alpha-2 code with a known alpha-3 (lowercase). */
export const KNOWN_ALPHA2: readonly string[] = Object.keys(ALPHA2_TO_ALPHA3);

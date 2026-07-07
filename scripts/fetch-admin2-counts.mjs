// Fetches geoBoundaries' per-country ADM2 unit counts and vendors them into
// src/lib/geo/admin2Counts.json as { worldTotal, counts: { [alpha2]: number } }.
//
// This is the DENOMINATOR for the worldwide "N 市町村 explored" exploration lens
// (see src/lib/explorationStats.ts): per-country coverage shows "visited / total"
// where total is that country's admUnitCount here. Countries with no ADM2 layer
// are omitted (a 0 would be indistinguishable from "not yet fetched").
//
// Only counts are vendored — never geometry — so the file stays tiny (~a few KB);
// the actual admin-2 boundaries are fetched dynamically at runtime and cached in
// IndexedDB (src/lib/geo/municipalResolver.ts). Map data © OpenStreetMap
// contributors via geoBoundaries (CC BY-SA); see docs/DATA_LICENSES.md.
//
// Safe to re-run and offline-tolerant: if every source is unreachable the
// existing vendored JSON is left untouched and the script exits 0, so builds
// keep working. geoBoundaries files are static CDN objects (no rate limit).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(rootDir, "src", "lib", "geo", "admin2Counts.json");

// geoBoundaries publishes a single metadata document listing every gbOpen layer
// with its admUnitCount and boundaryISO (ISO3). The CSV is the smallest/most
// stable; the JSON API's "ALL/ADM2" is tried as a fallback.
const META_CSV =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/geoBoundariesOpen-meta.csv";
const META_API = "https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM2/";

// ISO3 (uppercase) → alpha-2 (lowercase). Mirrors src/lib/geo/iso3.ts, inlined
// because this plain-node script can't import the TS module.
const ISO3_TO_ALPHA2 = {
  AFG: "af", ALB: "al", ATA: "aq", DZA: "dz", ASM: "as", AND: "ad", AGO: "ao", ATG: "ag",
  AZE: "az", ARG: "ar", AUS: "au", AUT: "at", BHS: "bs", BHR: "bh", BGD: "bd", ARM: "am",
  BRB: "bb", BEL: "be", BMU: "bm", BTN: "bt", BOL: "bo", BIH: "ba", BWA: "bw", BVT: "bv",
  BRA: "br", BLZ: "bz", IOT: "io", SLB: "sb", VGB: "vg", BRN: "bn", BGR: "bg", MMR: "mm",
  BDI: "bi", BLR: "by", KHM: "kh", CMR: "cm", CAN: "ca", CPV: "cv", CYM: "ky", CAF: "cf",
  LKA: "lk", TCD: "td", CHL: "cl", CHN: "cn", TWN: "tw", CXR: "cx", CCK: "cc", COL: "co",
  COM: "km", MYT: "yt", COG: "cg", COD: "cd", COK: "ck", CRI: "cr", HRV: "hr", CUB: "cu",
  CYP: "cy", CZE: "cz", BEN: "bj", DNK: "dk", DMA: "dm", DOM: "do", ECU: "ec", SLV: "sv",
  GNQ: "gq", ETH: "et", ERI: "er", EST: "ee", FRO: "fo", FLK: "fk", SGS: "gs", FJI: "fj",
  FIN: "fi", ALA: "ax", FRA: "fr", GUF: "gf", PYF: "pf", ATF: "tf", DJI: "dj", GAB: "ga",
  GEO: "ge", GMB: "gm", PSE: "ps", DEU: "de", GHA: "gh", GIB: "gi", KIR: "ki", GRC: "gr",
  GRL: "gl", GRD: "gd", GLP: "gp", GUM: "gu", GTM: "gt", GIN: "gn", GUY: "gy", HTI: "ht",
  HMD: "hm", VAT: "va", HND: "hn", HKG: "hk", HUN: "hu", ISL: "is", IND: "in", IDN: "id",
  IRN: "ir", IRQ: "iq", IRL: "ie", ISR: "il", ITA: "it", CIV: "ci", JAM: "jm", JPN: "jp",
  KAZ: "kz", JOR: "jo", KEN: "ke", PRK: "kp", KOR: "kr", KWT: "kw", KGZ: "kg", LAO: "la",
  LBN: "lb", LSO: "ls", LVA: "lv", LBR: "lr", LBY: "ly", LIE: "li", LTU: "lt", LUX: "lu",
  MAC: "mo", MDG: "mg", MWI: "mw", MYS: "my", MDV: "mv", MLI: "ml", MLT: "mt", MTQ: "mq",
  MRT: "mr", MUS: "mu", MEX: "mx", MCO: "mc", MNG: "mn", MDA: "md", MNE: "me", MSR: "ms",
  MAR: "ma", MOZ: "mz", OMN: "om", NAM: "na", NRU: "nr", NPL: "np", NLD: "nl", CUW: "cw",
  ABW: "aw", SXM: "sx", BES: "bq", NCL: "nc", VUT: "vu", NZL: "nz", NIC: "ni", NER: "ne",
  NGA: "ng", NIU: "nu", NFK: "nf", NOR: "no", MNP: "mp", UMI: "um", FSM: "fm", MHL: "mh",
  PLW: "pw", PAK: "pk", PAN: "pa", PNG: "pg", PRY: "py", PER: "pe", PHL: "ph", PCN: "pn",
  POL: "pl", PRT: "pt", GNB: "gw", TLS: "tl", PRI: "pr", QAT: "qa", REU: "re", ROU: "ro",
  RUS: "ru", RWA: "rw", BLM: "bl", SHN: "sh", KNA: "kn", AIA: "ai", LCA: "lc", MAF: "mf",
  SPM: "pm", VCT: "vc", SMR: "sm", STP: "st", SAU: "sa", SEN: "sn", SRB: "rs", SYC: "sc",
  SLE: "sl", SGP: "sg", SVK: "sk", VNM: "vn", SVN: "si", SOM: "so", ZAF: "za", ZWE: "zw",
  ESP: "es", SSD: "ss", SDN: "sd", ESH: "eh", SUR: "sr", SJM: "sj", SWZ: "sz", SWE: "se",
  CHE: "ch", SYR: "sy", TJK: "tj", THA: "th", TGO: "tg", TKL: "tk", TON: "to", TTO: "tt",
  ARE: "ae", TUN: "tn", TUR: "tr", TKM: "tm", TCA: "tc", TUV: "tv", UGA: "ug", UKR: "ua",
  MKD: "mk", EGY: "eg", GBR: "gb", GGY: "gg", JEY: "je", IMN: "im", TZA: "tz", USA: "us",
  VIR: "vi", BFA: "bf", URY: "uy", UZB: "uz", VEN: "ve", WLF: "wf", WSM: "ws", YEM: "ye",
  ZMB: "zm", XKX: "xk",
};

async function fetchText(url) {
  console.log(`fetching ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** One CSV row → array of cells, honoring double-quoted fields with commas. */
function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** Counts keyed by alpha-2 from the metadata CSV (ADM2 rows only). */
function countsFromCsv(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no rows");
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const isoIdx = header.findIndex((h) => /boundaryISO/i.test(h));
  const typeIdx = header.findIndex((h) => /boundaryType/i.test(h));
  const cntIdx = header.findIndex((h) => /admUnitCount/i.test(h));
  if (isoIdx < 0 || typeIdx < 0 || cntIdx < 0) {
    throw new Error(`CSV missing expected columns (got: ${header.join("|")})`);
  }
  const counts = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (!/ADM2/i.test(String(cells[typeIdx] ?? ""))) continue;
    const iso3 = String(cells[isoIdx] ?? "").trim().toUpperCase();
    const alpha2 = ISO3_TO_ALPHA2[iso3];
    const count = Number.parseInt(String(cells[cntIdx] ?? "").trim(), 10);
    if (!alpha2 || !Number.isFinite(count) || count <= 0) continue;
    counts[alpha2] = count;
  }
  return counts;
}

/** Counts keyed by alpha-2 from the JSON API's ALL/ADM2 listing. */
function countsFromApi(json) {
  const rows = Array.isArray(json) ? json : [json];
  const counts = {};
  for (const row of rows) {
    const iso3 = String(row?.boundaryISO ?? "").trim().toUpperCase();
    const alpha2 = ISO3_TO_ALPHA2[iso3];
    const count = Number.parseInt(String(row?.admUnitCount ?? "").trim(), 10);
    if (!alpha2 || !Number.isFinite(count) || count <= 0) continue;
    counts[alpha2] = count;
  }
  return counts;
}

async function loadCounts() {
  try {
    return countsFromCsv(await fetchText(META_CSV));
  } catch (err) {
    console.warn(`metadata CSV failed — ${err?.message ?? err}`);
  }
  try {
    return countsFromApi(JSON.parse(await fetchText(META_API)));
  } catch (err) {
    console.warn(`metadata API failed — ${err?.message ?? err}`);
  }
  return null;
}

const counts = await loadCounts();
if (!counts || Object.keys(counts).length === 0) {
  let existingNote = "";
  try {
    const existing = JSON.parse(readFileSync(outFile, "utf8"));
    existingNote = ` Existing file has ${Object.keys(existing.counts ?? {}).length} countries (kept).`;
  } catch {
    /* no existing file */
  }
  console.log(
    `geoBoundaries metadata unreachable (offline?). Nothing written — the app falls back to the ` +
      `seeded/vendored admin2Counts.json and still resolves municipalities dynamically.${existingNote}`,
  );
  process.exit(0);
}

// jp is vendored (src/components/map/municipal/jp.geojson) as the resolver's fast
// path; keep its denominator pinned to the product headline's "1742" even if the
// upstream count drifts, so "Japan 12/1742" stays stable.
if (!counts.jp) counts.jp = 1742;

const sorted = Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
const worldTotal = Object.values(sorted).reduce((a, b) => a + b, 0);
const payload = {
  source: "geoBoundaries gbOpen ADM2 (admUnitCount). Regenerate with `npm run fetch-admin2-counts`.",
  seeded: false,
  worldTotal,
  counts: sorted,
};
writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  `admin2Counts.json: ${Object.keys(sorted).length} countries with ADM2, ` +
    `worldTotal=${worldTotal.toLocaleString()} -> ${path.relative(rootDir, outFile)}`,
);

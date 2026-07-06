// Continent classification for the per-region exploration breakdown.
// Primary source: a static ISO 3166-1 alpha-2 -> continent table (covers the
// countries present in world-atlas's 110m dataset). Any code missing from the
// table (unexpected territory codes) falls back to a rough lat/lng-band guess
// so the breakdown never silently drops a country.

export type ContinentId = "africa" | "asia" | "europe" | "namerica" | "samerica" | "oceania" | "antarctica";

export const CONTINENT_ORDER: ContinentId[] = [
  "africa",
  "asia",
  "europe",
  "namerica",
  "samerica",
  "oceania",
  "antarctica",
];

const TABLE: Record<ContinentId, string[]> = {
  africa: [
    "dz", "ao", "bj", "bw", "bf", "bi", "cv", "cm", "cf", "td", "km", "cg", "cd", "ci", "dj",
    "eg", "gq", "er", "sz", "et", "ga", "gm", "gh", "gn", "gw", "ke", "ls", "lr", "ly", "mg",
    "mw", "ml", "mr", "mu", "ma", "mz", "na", "ne", "ng", "rw", "st", "sn", "sc", "sl", "so",
    "za", "ss", "sd", "tz", "tg", "tn", "ug", "zm", "zw", "eh",
  ],
  asia: [
    "af", "am", "az", "bh", "bd", "bt", "bn", "kh", "cn", "cy", "ge", "in", "id", "ir", "iq",
    "il", "jp", "jo", "kz", "kw", "kg", "la", "lb", "my", "mv", "mn", "mm", "np", "kp", "om",
    "pk", "ps", "ph", "qa", "sa", "sg", "kr", "lk", "sy", "tw", "tj", "th", "tl", "tr", "tm",
    "ae", "uz", "vn", "ye",
  ],
  europe: [
    "al", "ad", "at", "by", "be", "ba", "bg", "hr", "cz", "dk", "ee", "fi", "fr", "de", "gr",
    "hu", "is", "ie", "it", "xk", "lv", "li", "lt", "lu", "mt", "md", "mc", "me", "nl", "mk",
    "no", "pl", "pt", "ro", "ru", "sm", "rs", "sk", "si", "es", "se", "ch", "ua", "gb", "va",
  ],
  namerica: [
    "ag", "bs", "bz", "ca", "cr", "cu", "dm", "do", "sv", "gd", "gt", "ht", "hn", "jm", "mx",
    "ni", "pa", "kn", "lc", "vc", "tt", "us",
  ],
  samerica: ["ar", "bo", "br", "cl", "co", "ec", "gy", "py", "pe", "sr", "uy", "ve", "gf"],
  oceania: ["au", "fj", "ki", "mh", "fm", "nr", "nz", "pw", "pg", "ws", "sb", "to", "tv", "vu"],
  antarctica: ["aq"],
};

const CODE_TO_CONTINENT = new Map<string, ContinentId>();
for (const [continent, codes] of Object.entries(TABLE) as [ContinentId, string[]][]) {
  for (const code of codes) CODE_TO_CONTINENT.set(code, continent);
}

/** Rough fallback for codes not in the static table — approximate lat/lng bands. */
function continentFromCentroid(lat: number, lng: number): ContinentId {
  if (lat < -60) return "antarctica";
  if (lat < 0 && lng > 110) return "oceania";
  if (lng < -30 && lat > 15) return "namerica";
  if (lng < -30) return "samerica";
  if (lat > 35 && lng < 60) return "europe";
  if (lat > -35 && lat < 38 && lng < 55) return "africa";
  return "asia";
}

export function continentOf(code: string, centroid: { lat: number; lng: number }): ContinentId {
  return CODE_TO_CONTINENT.get(code) ?? continentFromCentroid(centroid.lat, centroid.lng);
}

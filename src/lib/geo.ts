// Country lookup from lat/lng via point-in-polygon over world-atlas's
// countries-110m topojson. Loaded with a `?raw` import (plain string, parsed
// with JSON.parse) rather than a normal JSON import so this module works
// without `resolveJsonModule` in tsconfig.app.json (not ours to change) and
// keeps the lookup fully offline, matching the P2P/no-server design.
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { Feature, GeoJsonProperties, MultiPolygon, Polygon } from "geojson";
// eslint-disable-next-line import/no-unresolved -- Vite `?raw` loader, see vite/client.d.ts
import worldRaw from "world-atlas/countries-110m.json?raw";
import type { Language } from "./types";

export interface CountryFeature {
  /** ISO 3166-1 alpha-2 lowercase; "" if this territory has no resolvable code. */
  code: string;
  name: string;
  geometry: Polygon | MultiPolygon;
}

// world-atlas ships three geometries with no numeric `id` at all (disputed
// territories Natural Earth still draws outlines for): Kosovo, Somaliland,
// N. Cyprus. None has an official ISO 3166-1 alpha-2 code, so we fall back
// to a small name-keyed override table instead of leaving them unresolvable
// (which would make encounters there silently fail to lift any country's fog).
const NAME_OVERRIDES: Record<string, string> = {
  Kosovo: "xk",
  Somaliland: "so",
  "N. Cyprus": "cy",
};

// ISO 3166-1 numeric -> alpha-2 (lowercase), covering every country in
// world-atlas's countries-110m (verified: zero unmapped ids against the
// 177 geometries it ships, cross-checked against the full 249-entry ISO
// 3166 standard so codes outside the current atlas resolve too).
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  "004": "af", "008": "al", "010": "aq", "012": "dz", "016": "as", "020": "ad", "024": "ao", "028": "ag",
  "031": "az", "032": "ar", "036": "au", "040": "at", "044": "bs", "048": "bh", "050": "bd", "051": "am",
  "052": "bb", "056": "be", "060": "bm", "064": "bt", "068": "bo", "070": "ba", "072": "bw", "074": "bv",
  "076": "br", "084": "bz", "086": "io", "090": "sb", "092": "vg", "096": "bn", "100": "bg", "104": "mm",
  "108": "bi", "112": "by", "116": "kh", "120": "cm", "124": "ca", "132": "cv", "136": "ky", "140": "cf",
  "144": "lk", "148": "td", "152": "cl", "156": "cn", "158": "tw", "162": "cx", "166": "cc", "170": "co",
  "174": "km", "175": "yt", "178": "cg", "180": "cd", "184": "ck", "188": "cr", "191": "hr", "192": "cu",
  "196": "cy", "203": "cz", "204": "bj", "208": "dk", "212": "dm", "214": "do", "218": "ec", "222": "sv",
  "226": "gq", "231": "et", "232": "er", "233": "ee", "234": "fo", "238": "fk", "239": "gs", "242": "fj",
  "246": "fi", "248": "ax", "250": "fr", "254": "gf", "258": "pf", "260": "tf", "262": "dj", "266": "ga",
  "268": "ge", "270": "gm", "275": "ps", "276": "de", "288": "gh", "292": "gi", "296": "ki", "300": "gr",
  "304": "gl", "308": "gd", "312": "gp", "316": "gu", "320": "gt", "324": "gn", "328": "gy", "332": "ht",
  "334": "hm", "336": "va", "340": "hn", "344": "hk", "348": "hu", "352": "is", "356": "in", "360": "id",
  "364": "ir", "368": "iq", "372": "ie", "376": "il", "380": "it", "384": "ci", "388": "jm", "392": "jp",
  "398": "kz", "400": "jo", "404": "ke", "408": "kp", "410": "kr", "414": "kw", "417": "kg", "418": "la",
  "422": "lb", "426": "ls", "428": "lv", "430": "lr", "434": "ly", "438": "li", "440": "lt", "442": "lu",
  "446": "mo", "450": "mg", "454": "mw", "458": "my", "462": "mv", "466": "ml", "470": "mt", "474": "mq",
  "478": "mr", "480": "mu", "484": "mx", "492": "mc", "496": "mn", "498": "md", "499": "me", "500": "ms",
  "504": "ma", "508": "mz", "512": "om", "516": "na", "520": "nr", "524": "np", "528": "nl", "531": "cw",
  "533": "aw", "534": "sx", "535": "bq", "540": "nc", "548": "vu", "554": "nz", "558": "ni", "562": "ne",
  "566": "ng", "570": "nu", "574": "nf", "578": "no", "580": "mp", "581": "um", "583": "fm", "584": "mh",
  "585": "pw", "586": "pk", "591": "pa", "598": "pg", "600": "py", "604": "pe", "608": "ph", "612": "pn",
  "616": "pl", "620": "pt", "624": "gw", "626": "tl", "630": "pr", "634": "qa", "638": "re", "642": "ro",
  "643": "ru", "646": "rw", "652": "bl", "654": "sh", "659": "kn", "660": "ai", "662": "lc", "663": "mf",
  "666": "pm", "670": "vc", "674": "sm", "678": "st", "682": "sa", "686": "sn", "688": "rs", "690": "sc",
  "694": "sl", "702": "sg", "703": "sk", "704": "vn", "705": "si", "706": "so", "710": "za", "716": "zw",
  "724": "es", "728": "ss", "729": "sd", "732": "eh", "740": "sr", "744": "sj", "748": "sz", "752": "se",
  "756": "ch", "760": "sy", "762": "tj", "764": "th", "768": "tg", "772": "tk", "776": "to", "780": "tt",
  "784": "ae", "788": "tn", "792": "tr", "795": "tm", "796": "tc", "798": "tv", "800": "ug", "804": "ua",
  "807": "mk", "818": "eg", "826": "gb", "831": "gg", "832": "je", "833": "im", "834": "tz", "840": "us",
  "850": "vi", "854": "bf", "858": "uy", "860": "uz", "862": "ve", "876": "wf", "882": "ws", "887": "ye",
  "894": "zm",
};

export function numericToAlpha2(numericId: string): string {
  const key = numericId.padStart(3, "0");
  return NUMERIC_TO_ALPHA2[key] ?? "";
}

function resolveCode(f: Feature<Polygon | MultiPolygon, GeoJsonProperties>): string {
  if (f.id != null) {
    const code = numericToAlpha2(String(f.id));
    if (code) return code;
  }
  const name = (f.properties?.name as string | undefined) ?? "";
  return NAME_OVERRIDES[name] ?? "";
}

let cachedWorld: Promise<{ features: CountryFeature[] }> | null = null;

export function loadWorld(): Promise<{ features: CountryFeature[] }> {
  if (!cachedWorld) {
    cachedWorld = Promise.resolve().then(() => {
      const topology = JSON.parse(worldRaw) as Topology;
      const countries = topology.objects.countries as GeometryCollection<GeoJsonProperties>;
      const collection = feature(topology, countries);
      const features: CountryFeature[] = [];
      for (const f of collection.features) {
        if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") continue;
        features.push({
          code: resolveCode(f as Feature<Polygon | MultiPolygon, GeoJsonProperties>),
          name: (f.properties?.name as string | undefined) ?? "",
          geometry: f.geometry,
        });
      }
      return { features };
    });
  }
  return cachedWorld;
}

// Even-odd ray-casting across every ring of a polygon: a crossing of the
// outer ring flips inside/outside, and a crossing of a hole ring flips it
// back — so a point inside a hole correctly reads as outside the country.
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, coordinates: number[][][]): boolean {
  let inside = false;
  for (const ring of coordinates) {
    if (pointInRing(lng, lat, ring)) inside = !inside;
  }
  return inside;
}

/** Exported for unit testing the ray-casting logic in isolation from the atlas data. */
export function pointInGeometry(lng: number, lat: number, geometry: Polygon | MultiPolygon): boolean {
  if (geometry.type === "Polygon") return pointInPolygon(lng, lat, geometry.coordinates);
  return geometry.coordinates.some((polygonCoords) => pointInPolygon(lng, lat, polygonCoords));
}

/** ISO 3166-1 alpha-2 lowercase, or "" if the point falls in the ocean / no country matched. */
export async function lookupCountry(lat: number, lng: number): Promise<string> {
  const { features } = await loadWorld();
  for (const f of features) {
    if (f.code && pointInGeometry(lng, lat, f.geometry)) return f.code;
  }
  return "";
}

export function countryName(code: string, lang: Language): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  try {
    const dn = new Intl.DisplayNames([lang], { type: "region" });
    return dn.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

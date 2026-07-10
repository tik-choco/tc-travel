// Search-by-name location picker — the escape hatch for the map's core
// complaint (picking an exact pixel on a globe/SVG is fiddly). Indexes every
// country (localized name + English fallback, so a traveller can type either)
// and every Japan prefecture (English + Japanese), resolving a pick to the
// same {lat, lng, countryCode} shape a successful map tap produces.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { MapPin, Search, X } from "lucide-preact";
import { getLanguage, translate, useT } from "../../lib/i18n";
import { loadWorld, countryName } from "../../lib/geo";
import { KNOWN_ALPHA2 } from "../../lib/geo/iso3";
import { loadJapanPrefectures } from "./japanGeo";
import { geometryCentroid } from "./geoMath";
import type { SimpleGeometry } from "./geoMath";
import { geometryAnchor } from "./globe/geoSphere";
import "./map.i18n";

export interface PickedLocation {
  lat: number;
  lng: number;
  label: string;
  /** ISO 3166-1 alpha-2 lowercase — always resolved, since every indexed
   *  entry (country or prefecture) belongs to a known country. */
  countryCode: string;
}

interface SearchEntry {
  key: string;
  label: string;
  lat: number;
  lng: number;
  countryCode: string;
  terms: string[];
}

interface LocationPickerProps {
  onSelect: (loc: PickedLocation) => void;
  onClose: () => void;
}

const MAX_RESULTS = 8;

function buildIndex(
  world: { code: string; geometry: SimpleGeometry }[],
  prefs: { code: string; name: string; name_ja: string; geometry: SimpleGeometry }[],
): SearchEntry[] {
  const out: SearchEntry[] = [];
  const worldByCode = new Map(world.map((f) => [f.code, f]));

  for (const code of KNOWN_ALPHA2) {
    const f = worldByCode.get(code);
    if (!f) continue;
    const localName = countryName(code, getLanguage());
    const enName = countryName(code, "en");
    const label = localName || enName || code.toUpperCase();
    if (!label) continue;
    const anchor = geometryAnchor(f.geometry) ?? geometryCentroid(f.geometry);
    out.push({
      key: `c:${code}`,
      label,
      lat: anchor.lat,
      lng: anchor.lng,
      countryCode: code,
      terms: [localName, enName].filter(Boolean).map((s) => s.toLowerCase()),
    });
  }

  const japanName = countryName("jp", getLanguage());
  for (const p of prefs) {
    const regionLabel = getLanguage() === "ja" ? p.name_ja : p.name;
    const anchor = geometryAnchor(p.geometry) ?? geometryCentroid(p.geometry);
    out.push({
      key: `p:${p.code}`,
      label: japanName ? translate("map.picker.place", { region: regionLabel, country: japanName }) : regionLabel,
      lat: anchor.lat,
      lng: anchor.lng,
      countryCode: "jp",
      terms: [p.name.toLowerCase(), p.name_ja.toLowerCase()],
    });
  }

  return out;
}

/** Lightweight search-by-name modal: type a country or Japan prefecture,
 *  pick a result, and the caller opens the encounter sheet there — no
 *  external search/autocomplete dependency, just a filtered in-memory list. */
export function LocationPicker({ onSelect, onClose }: LocationPickerProps) {
  const t = useT();
  const lang = getLanguage();
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorld(), loadJapanPrefectures().catch(() => [])]).then(([world, prefs]) => {
      if (!cancelled) setEntries(buildIndex(world.features, prefs));
    });
    return () => {
      cancelled = true;
    };
    // lang: entry labels/terms are localized at build time, so a language
    // switch while the picker happens to be open should re-index.
  }, [lang]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !entries) return [] as SearchEntry[];
    const starts: SearchEntry[] = [];
    const contains: SearchEntry[] = [];
    for (const e of entries) {
      const startsHit = e.terms.some((term) => term.startsWith(q));
      const containsHit = !startsHit && e.terms.some((term) => term.includes(q));
      if (startsHit) starts.push(e);
      else if (containsHit) contains.push(e);
    }
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  }, [entries, query]);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-card map-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="map-sheet__inner">
          <div class="map-sheet__header">
            <h2 class="title-ornate">{t("map.picker.title")}</h2>
            <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.sheet.cancel")}>
              <X size={20} />
            </button>
          </div>
          <div class="map-picker__search">
            <Search size={16} class="map-picker__search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              class="input"
              type="text"
              value={query}
              placeholder={t("map.picker.placeholder")}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </div>
          {query.trim() !== "" && entries && results.length === 0 && (
            <p class="map-sheet__hint">{t("map.picker.noResults")}</p>
          )}
          {results.length > 0 && (
            <ul class="map-picker__list">
              {results.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    class="list-item map-picker__item"
                    onClick={() => onSelect({ lat: r.lat, lng: r.lng, label: r.label, countryCode: r.countryCode })}
                  >
                    <MapPin size={16} aria-hidden="true" />
                    <span>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowLeft, Check } from "lucide-preact";
import { useT } from "../../../lib/i18n";
import { useUnifiedJourney } from "../../../lib/memories";
import { loadJapanPrefectures, type Prefecture } from "../japanGeo";
import {
  loadMunicipalities,
  municipalitiesOfPref,
  prefMunicipalStats,
  visitedMunicipalities,
  type GeoPointLike,
  type Municipality,
} from "./municipalGeo";
import "./municipal.i18n";
import "./municipal.css";

const REVEAL_ANIM_MS = 1400;

// --- hook: journey → visited municipality set ----------------------------------

/** Derives {municipalities, visited} from the unified journey (room + solo
 *  pins, geo photos, geo diary) — the municipality-tier sibling of
 *  useJapanCollection. `active` gates the lazy ~2.2 MB geojson load so
 *  JapanMap can mount this unconditionally and only pay when municipality
 *  data is actually vendored. */
export function useMunicipalCollection(active: boolean): {
  munis: Municipality[] | null;
  visited: Set<string>;
} {
  const journey = useUnifiedJourney();
  const [munis, setMunis] = useState<Municipality[] | null>(null);
  const [prefs, setPrefs] = useState<Prefecture[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadMunicipalities("jp")
      .then((m) => {
        if (!cancelled) setMunis(m);
      })
      .catch((err) => console.warn("tc-travel: municipality data unavailable", err));
    // prefecture geometry powers the visit pre-filter (module-cached, so this
    // is free when the prefecture map already loaded it)
    loadJapanPrefectures()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((err) => console.warn("tc-travel: japan prefecture data unavailable", err));
    return () => {
      cancelled = true;
    };
  }, [active]);

  // useUnifiedJourney() re-reads its stores each render, so its arrays are
  // always fresh identities — key the expensive point-in-polygon pass on a
  // cheap content fingerprint instead (same trick as useJapanCollection).
  const points: GeoPointLike[] = [];
  for (const p of journey.pins) points.push(p);
  for (const p of journey.photos) if (p.geo) points.push(p.geo);
  for (const d of journey.diary) if (d.geo) points.push(d.geo);
  const pointsKey = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");

  const visited = useMemo(
    () => (munis && prefs ? visitedMunicipalities(points, munis, prefs) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pointsKey stands in for `points`
    [munis, prefs, pointsKey],
  );
  return { munis, visited };
}

// --- component -------------------------------------------------------------------

interface MunicipalMapProps {
  /** ISO 3166-2 prefecture code, e.g. "JP-13" */
  pref: string;
  /** Display name for the prefecture, already language-resolved by the caller */
  prefName: string;
  onClose: () => void;
}

/** One prefecture's municipality collection — a fog→gold chip grid rather
 *  than another polygon map: per-prefecture counts run 15–179, where a warm,
 *  name-forward grid reads better than hairline borders (the vendored
 *  geometry still powers visit resolution, and later the globe LOD pass).
 *  Rendered as an overlay above the Japan drill-down, which stays mounted. */
export function MunicipalMap({ pref, prefName, onClose }: MunicipalMapProps) {
  const t = useT();
  const { munis, visited } = useMunicipalCollection(true);
  const list = useMemo(() => (munis ? municipalitiesOfPref(munis, pref) : []), [munis, pref]);
  const stats = prefMunicipalStats(visited, munis ?? [], pref);
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  // Reveal pop for municipalities that newly enter the set WHILE the view is
  // open — primed on load exactly like the prefecture map, so opening the
  // grid never fires a celebration by itself.
  const prevVisitedRef = useRef<Set<string>>(new Set());
  const firstRevealRef = useRef(true);
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!munis) return;
    const prev = prevVisitedRef.current;
    const fresh = [...visited].filter((c) => !prev.has(c));
    prevVisitedRef.current = new Set(visited);
    const isFirst = firstRevealRef.current;
    firstRevealRef.current = false;
    if (fresh.length === 0 || isFirst) return;
    setRevealing((r) => new Set([...r, ...fresh]));
    const timer = setTimeout(() => {
      setRevealing((r) => {
        const next = new Set(r);
        for (const c of fresh) next.delete(c);
        return next;
      });
    }, REVEAL_ANIM_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visitedKey stands in for `visited`
  }, [visitedKey, munis]);

  // Header pulse when this prefecture's count rises — primed on first value.
  const prevCountRef = useRef<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!munis) return;
    const prev = prevCountRef.current;
    prevCountRef.current = stats.count;
    if (prev === null || stats.count <= prev) return;
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), 1300);
    return () => clearTimeout(timer);
  }, [stats.count, munis]);

  const barPct = stats.count > 0 ? Math.max(stats.exactPct, 1.5) : 0;

  return (
    <div class="muni-overlay">
      <div class={["panel", "panel-tight", "muni-header", celebrate ? "muni-header--pulse" : ""].filter(Boolean).join(" ")}>
        <div class="muni-header__row">
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.muni.back")}>
            <ArrowLeft size={20} />
          </button>
          <h1 class="muni-title">{t("map.muni.title", { pref: prefName })}</h1>
        </div>
        <p class="muni-count">{t("map.muni.count", { count: stats.count, total: stats.total, pct: stats.pct })}</p>
        <div class="muni-progress" aria-hidden="true">
          <div class="muni-progress__fill" style={{ width: `${barPct}%` }} />
        </div>
      </div>

      <div class="muni-grid-area">
        {!munis && <p class="muni-status">{t("map.muni.loading")}</p>}
        {munis && list.length === 0 && <p class="muni-status">{t("map.muni.empty")}</p>}
        {list.length > 0 && (
          <div class="muni-grid">
            {list.map((m) => {
              const isVisited = visited.has(m.code);
              return (
                <span
                  key={m.code}
                  class={[
                    "muni-chip",
                    isVisited ? "muni-chip--visited" : "muni-chip--fog",
                    revealing.has(m.code) ? "muni-chip--revealing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label={`${m.name}: ${t(isVisited ? "map.muni.visitedState" : "map.muni.unvisitedState")}`}
                >
                  {isVisited && <Check size={12} aria-hidden="true" />}
                  {m.name}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <p class="muni-credit">{t("map.muni.credit")}</p>
    </div>
  );
}

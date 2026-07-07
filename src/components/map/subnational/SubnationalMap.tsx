import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowLeft, Sparkles, X } from "lucide-preact";
import { getLanguage, useT } from "../../../lib/i18n";
import { countryName } from "../../../lib/geo";
import { useUnifiedJourney } from "../../../lib/memories";
import {
  buildLayout,
  insetsFor,
  loadCountry,
  visitedSubdivisions,
  type GeoPointLike,
  type Subdivision,
} from "./subnationalGeo";
import { subnationalEntry } from "./registry";
import "./subnational.i18n";
import "./subnational.css";

const REVEAL_ANIM_MS = 1400;

// --- hook: journey → visited subdivision set ----------------------------------

/** Derives {subdivisions, visited} for one country from the unified journey
 *  (room + solo pins, geo photos, geo diary) — the generic sibling of
 *  japanGeo's useJapanCollection, keyed by country code. */
function useSubnationalCollection(countryCode: string): {
  subs: Subdivision[] | null;
  visited: Set<string>;
  failed: boolean;
} {
  const journey = useUnifiedJourney();
  const [subs, setSubs] = useState<Subdivision[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSubs(null);
    setFailed(false);
    loadCountry(countryCode)
      .then((s) => {
        if (!cancelled) setSubs(s);
      })
      .catch((err) => {
        console.warn(`tc-travel: sub-national data unavailable for "${countryCode}"`, err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  // useUnifiedJourney() re-reads its stores each render, so its arrays are
  // always fresh identities — key the expensive point-in-polygon pass on a
  // cheap content fingerprint instead (same trick as useJapanCollection).
  const points: GeoPointLike[] = [];
  for (const p of journey.pins) points.push(p);
  for (const p of journey.photos) if (p.geo) points.push(p.geo);
  for (const d of journey.diary) if (d.geo) points.push(d.geo);
  const pointsKey = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");

  const visited = useMemo(
    () => (subs ? visitedSubdivisions(points, subs) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pointsKey stands in for `points`
    [subs, pointsKey],
  );
  return { subs, visited, failed };
}

// --- component -----------------------------------------------------------------

interface SubnationalMapProps {
  /** ISO 3166-1 alpha-2 (case-insensitive), e.g. "us", "kr" */
  countryCode: string;
  onClose: () => void;
}

/** Generic sub-national drill-down — the world map's fog-of-war retention loop
 *  at state/province granularity for any vendored country, mirroring the
 *  Japan map's warmth: fog → golden reveal, completion bar, milestone pulses,
 *  and a short brag line. Rendered as an overlay inside .map-viewport so the
 *  world map stays mounted underneath. (Japan itself keeps its own JapanMap —
 *  see registry.ts.) */
export function SubnationalMap({ countryCode, onClose }: SubnationalMapProps) {
  const t = useT();
  const lang = getLanguage();
  const entry = subnationalEntry(countryCode);
  const country = entry
    ? t(entry.displayNameKey)
    : countryName(countryCode, lang) || countryCode.toUpperCase();
  const { subs, visited, failed } = useSubnationalCollection(countryCode);
  const [selected, setSelected] = useState<string | null>(null);

  // Path strings + reveal anchors only depend on the immutable geometry —
  // built once per country, not per render.
  const layout = useMemo(
    () => (subs ? buildLayout(subs, 720, insetsFor(countryCode)) : null),
    [subs, countryCode],
  );
  const subByCode = useMemo(() => new Map(subs?.map((s) => [s.code, s]) ?? []), [subs]);

  const total = subs?.length ?? 0;
  const count = visited.size;
  const exactPct = total > 0 ? (count / total) * 100 : 0;
  const pct = Math.round(exactPct);
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  // Same reveal choreography as JapanMap: everything already visited shimmers
  // once when the view opens (the atlas "waking up"); golden bursts are
  // reserved for subdivisions that newly enter the set WHILE the view is open.
  // Both refs stay primed-off until the geojson has loaded — otherwise the
  // 0 → N jump on load would read as N fresh unlocks and burst everywhere.
  const prevVisitedRef = useRef<Set<string>>(new Set());
  const firstRevealRef = useRef(true);
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  const [bursting, setBursting] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!subs) return;
    const prev = prevVisitedRef.current;
    const fresh = [...visited].filter((c) => !prev.has(c));
    prevVisitedRef.current = new Set(visited);
    const isFirst = firstRevealRef.current;
    firstRevealRef.current = false;
    if (fresh.length === 0) return;
    setRevealing((r) => new Set([...r, ...fresh]));
    if (!isFirst) setBursting((b) => new Set([...b, ...fresh]));
    const timer = setTimeout(() => {
      setRevealing((r) => {
        const next = new Set(r);
        for (const c of fresh) next.delete(c);
        return next;
      });
      setBursting((b) => {
        const next = new Set(b);
        for (const c of fresh) next.delete(c);
        return next;
      });
    }, REVEAL_ANIM_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visitedKey stands in for `visited`
  }, [visitedKey, subs]);

  // Milestone celebration when completion % rises — primed on the first
  // computed value so opening the view never celebrates by itself.
  const prevPctRef = useRef<number | null>(null);
  const [celebrate, setCelebrate] = useState<"" | "pulse" | "milestone">("");
  useEffect(() => {
    if (!subs) return;
    const prev = prevPctRef.current;
    prevPctRef.current = pct;
    if (prev === null || pct <= prev) return;
    const crossedTens = Math.floor(pct / 10) > Math.floor(prev / 10);
    setCelebrate(pct === 100 || crossedTens ? "milestone" : "pulse");
    const timer = setTimeout(() => setCelebrate(""), 1300);
    return () => clearTimeout(timer);
  }, [pct, subs]);

  // Same "first region must move the needle" trick as the world map's bar.
  const barPct = count > 0 ? Math.max(exactPct, 1.5) : 0;

  const revealBursts = useMemo(() => {
    if (!layout || bursting.size === 0) return [] as { code: string; x: number; y: number }[];
    const bursts: { code: string; x: number; y: number }[] = [];
    for (const code of bursting) {
      const p = layout.paths.find((path) => path.code === code);
      if (p?.anchor) bursts.push({ code, x: p.anchor[0], y: p.anchor[1] });
    }
    return bursts;
  }, [layout, bursting]);

  const insetCodes = useMemo(() => new Set(layout?.insets.map((i) => i.code) ?? []), [layout]);
  const selectedSub = selected ? subByCode.get(selected) : undefined;

  const subClasses = (code: string): string =>
    [
      "sub-region",
      visited.has(code) ? "sub-region--visited" : "sub-region--fog",
      revealing.has(code) ? "sub-region--revealing" : "",
      selected === code ? "sub-region--selected" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const renderRegion = (p: { code: string; d: string }) => (
    <path
      key={p.code}
      class={subClasses(p.code)}
      d={p.d}
      aria-label={subByCode.get(p.code)?.name ?? p.code}
      onClick={() => setSelected(p.code)}
    />
  );

  return (
    <div class="sub-overlay">
      <div
        class={["panel", "panel-tight", "sub-header", celebrate ? `sub-header--${celebrate}` : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <div class="sub-header__row">
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.sub.back")}>
            <ArrowLeft size={20} />
          </button>
          <h1 class="sub-title">{t("map.sub.title", { country })}</h1>
          {total > 0 && pct === 100 && (
            <span class="sub-complete-chip">
              <Sparkles size={12} />
              {t("map.sub.complete")}
            </span>
          )}
        </div>
        <p class="sub-completion">{t("map.sub.completion", { count, total, pct })}</p>
        <div class="sub-progress" aria-hidden="true">
          <div class="sub-progress__fill" style={{ width: `${barPct}%` }} />
        </div>
        {count > 0 && <p class="sub-summary">{t("map.sub.summary", { count, total, country })}</p>}
      </div>

      <div class="sub-map-area">
        {failed && <p class="sub-status">{t("map.sub.nodata")}</p>}
        {!failed && !layout && <p class="sub-status">{t("map.sub.loading")}</p>}
        {layout && (
          <svg
            class="sub-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-label={t("map.sub.title", { country })}
          >
            <defs>
              {/* Same theme-following stop-class pattern as the world/Japan maps. */}
              <radialGradient id="sub-ocean-grad" cx="50%" cy="40%" r="85%">
                <stop offset="0%" class="sub-ocean-stop--core" />
                <stop offset="55%" class="sub-ocean-stop--mid" />
                <stop offset="100%" class="sub-ocean-stop--edge" />
              </radialGradient>
              <linearGradient
                id="sub-land-grad"
                x1={0}
                y1={0}
                x2={0}
                y2={layout.height}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" class="sub-land-stop--north" />
                <stop offset="55%" class="sub-land-stop--mid" />
                <stop offset="100%" class="sub-land-stop--south" />
              </linearGradient>
              {/* Inset subdivisions are clipped to their frames so curated fits
                  (e.g. Hawaii's main-islands frame) can't spill across the map. */}
              {layout.insets.map((f) => (
                <clipPath key={f.code} id={`sub-clip-${f.code}`}>
                  <rect x={f.x - 4} y={f.y - 4} width={f.w + 8} height={f.h + 8} rx={6} />
                </clipPath>
              ))}
            </defs>
            <rect
              class="sub-ocean"
              x={0}
              y={0}
              width={layout.width}
              height={layout.height}
              onClick={() => setSelected(null)}
            />
            {layout.insets.map((f) => (
              <rect
                key={f.code}
                class="sub-inset-frame"
                x={f.x - 4}
                y={f.y - 4}
                width={f.w + 8}
                height={f.h + 8}
                rx={6}
                aria-hidden="true"
              />
            ))}
            {/* Fog first, then visited land in a single glow group — one group
                filter instead of one per path. */}
            <g>
              {layout.paths
                .filter((p) => !insetCodes.has(p.code) && !visited.has(p.code))
                .map(renderRegion)}
            </g>
            <g class="sub-land-glow">
              {layout.paths
                .filter((p) => !insetCodes.has(p.code) && visited.has(p.code))
                .map(renderRegion)}
            </g>
            {layout.paths
              .filter((p) => insetCodes.has(p.code))
              .map((p) => (
                <g
                  key={p.code}
                  clip-path={`url(#sub-clip-${p.code})`}
                  class={visited.has(p.code) ? "sub-land-glow" : undefined}
                >
                  {renderRegion(p)}
                </g>
              ))}
            {revealBursts.map((b) => (
              <g key={b.code} class="sub-reveal-burst" aria-hidden="true" transform={`translate(${b.x}, ${b.y})`}>
                <circle class="sub-reveal-burst__ripple" r={6} />
                <circle class="sub-reveal-burst__ripple sub-reveal-burst__ripple--late" r={6} />
                <path class="sub-reveal-burst__star" d="M0,-14 L3,-3 L14,0 L3,3 L0,14 L-3,3 L-14,0 L-3,-3 Z" />
              </g>
            ))}
          </svg>
        )}

        {selectedSub && (
          <div class="panel sub-selected">
            <div class="sub-selected__head">
              <h2 class="sub-selected__name">{selectedSub.name}</h2>
              <button
                type="button"
                class="btn btn-icon"
                onClick={() => setSelected(null)}
                aria-label={t("map.sub.close")}
              >
                <X size={18} />
              </button>
            </div>
            <p class="sub-selected__sub">
              {selectedSub.name_local ? `${selectedSub.name_local} · ` : ""}
              {selectedSub.code}
            </p>
            <p
              class={[
                "sub-selected__state",
                visited.has(selectedSub.code) ? "sub-selected__state--visited" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {visited.has(selectedSub.code) ? t("map.sub.visitedState") : t("map.sub.unvisitedState")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

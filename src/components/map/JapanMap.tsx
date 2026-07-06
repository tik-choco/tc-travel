import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowLeft, Award, Share2, X } from "lucide-preact";
import { getLanguage, useT } from "../../lib/i18n";
import { useJapanCollection, buildJapanLayout } from "./japanGeo";
import { badgeLabel, completionStats, earnedBadges, rarityOf, regionStats } from "./collection";
import "./map.i18n";
import "./map.css";

const REVEAL_ANIM_MS = 1400;

interface JapanMapProps {
  onClose: () => void;
  onBrag: () => void;
}

/** Prefecture drill-down for Japan — the world map's fog-of-war retention
 *  loop at 47-prefecture granularity, plus the collection layer (completion,
 *  regions, rarity, badges). Rendered as an overlay inside .map-viewport so
 *  the world map stays mounted underneath. */
export function JapanMap({ onClose, onBrag }: JapanMapProps) {
  const t = useT();
  const lang = getLanguage();
  const { prefs, visited } = useJapanCollection(true);
  const [selected, setSelected] = useState<string | null>(null);

  // Path strings + reveal anchors only depend on the immutable geometry —
  // built once, not per render (47 detailed MultiPolygons).
  const layout = useMemo(() => (prefs ? buildJapanLayout(prefs) : null), [prefs]);
  const prefByCode = useMemo(() => new Map(prefs?.map((p) => [p.code, p]) ?? []), [prefs]);

  const stats = completionStats(visited);
  const regions = regionStats(visited);
  const badges = earnedBadges(visited);
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  // Same reveal choreography as WorldMap: everything already visited shimmers
  // once when the view opens (the atlas "waking up"), while golden bursts are
  // reserved for prefectures that newly enter the set WHILE the view is open.
  // Both refs stay primed-off until the geojson has loaded — otherwise the
  // 0 → N jump on load would read as N fresh unlocks and burst everywhere.
  const prevVisitedRef = useRef<Set<string>>(new Set());
  const firstRevealRef = useRef(true);
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  const [bursting, setBursting] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!prefs) return;
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
  }, [visitedKey, prefs]);

  // Milestone celebration when completion % rises — primed on the first
  // computed value so opening the view never celebrates by itself.
  const prevPctRef = useRef<number | null>(null);
  const [celebrate, setCelebrate] = useState<"" | "pulse" | "milestone">("");
  useEffect(() => {
    if (!prefs) return;
    const prev = prevPctRef.current;
    prevPctRef.current = stats.pct;
    if (prev === null || stats.pct <= prev) return;
    const crossedTens = Math.floor(stats.pct / 10) > Math.floor(prev / 10);
    setCelebrate(stats.pct === 100 || crossedTens ? "milestone" : "pulse");
    const timer = setTimeout(() => setCelebrate(""), 1300);
    return () => clearTimeout(timer);
  }, [stats.pct, prefs]);

  // Same "first prefecture must move the needle" trick as the world map's bar.
  const barPct = stats.count > 0 ? Math.max(stats.exactPct, 1.5) : 0;

  const revealBursts = useMemo(() => {
    if (!layout || bursting.size === 0) return [] as { code: string; x: number; y: number }[];
    const bursts: { code: string; x: number; y: number }[] = [];
    for (const code of bursting) {
      const p = layout.paths.find((entry) => entry.code === code);
      if (p?.anchor) bursts.push({ code, x: p.anchor[0], y: p.anchor[1] });
    }
    return bursts;
  }, [layout, bursting]);

  const selectedPref = selected ? prefByCode.get(selected) : undefined;
  const prefName = (code: string): string => {
    const p = prefByCode.get(code);
    if (!p) return code;
    return lang === "ja" ? p.name_ja : p.name;
  };

  return (
    <div class="jp-overlay">
      <div class={["panel", "panel-tight", "jp-header", celebrate ? `jp-header--${celebrate}` : ""].filter(Boolean).join(" ")}>
        <div class="jp-header__row">
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.jp.back")}>
            <ArrowLeft size={20} />
          </button>
          <h1 class="jp-title">{t("map.jp.title")}</h1>
          <button type="button" class="btn btn-icon" onClick={onBrag} aria-label={t("map.brag.make")}>
            <Share2 size={18} />
          </button>
        </div>
        <p class="jp-completion">{t("map.jp.completion", { count: stats.count, total: stats.total, pct: stats.pct })}</p>
        <div class="map-progress" aria-hidden="true">
          <div class="map-progress__fill" style={{ width: `${barPct}%` }} />
        </div>
        <div class="jp-chips">
          {regions.map((r) => (
            <span
              key={r.id}
              class={["map-continent-chip", r.count === r.total ? "jp-chip--complete" : ""].filter(Boolean).join(" ")}
            >
              {t(`map.jp.region.${r.id}`)} {r.count}/{r.total}
            </span>
          ))}
        </div>
        {badges.length > 0 && (
          <div class="jp-badges">
            {badges.map((id) => (
              <span class="jp-badge" key={id}>
                <Award size={12} />
                {badgeLabel(id, t)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div class="jp-map-area">
        {!layout && <p class="map-loading">{t("map.loading")}</p>}
        {layout && (
          <svg class="jp-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label={t("map.jp.title")}>
            <defs>
              {/* Same theme-following stop classes as the world map's defs. */}
              <radialGradient id="jp-ocean-grad" cx="50%" cy="40%" r="85%">
                <stop offset="0%" class="map-ocean-stop--core" />
                <stop offset="55%" class="map-ocean-stop--mid" />
                <stop offset="100%" class="map-ocean-stop--edge" />
              </radialGradient>
              <linearGradient id="jp-land-grad" x1={0} y1={0} x2={0} y2={layout.height} gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="map-land-stop--north" />
                <stop offset="55%" class="map-land-stop--mid" />
                <stop offset="100%" class="map-land-stop--south" />
              </linearGradient>
            </defs>
            <rect class="jp-ocean" x={0} y={0} width={layout.width} height={layout.height} onClick={() => setSelected(null)} />
            <rect
              class="jp-inset-frame"
              x={layout.inset.x - 4}
              y={layout.inset.y - 4}
              width={layout.inset.w + 8}
              height={layout.inset.h + 8}
              rx={6}
              aria-hidden="true"
            />
            {/* Fog first, then visited land in a single glow group — one group
                filter instead of 47 per-path filters. */}
            <g>
              {layout.paths
                .filter((p) => !visited.has(p.code))
                .map((p) => (
                  <path
                    key={p.code}
                    class={["jp-pref", "jp-pref--fog", selected === p.code ? "jp-pref--selected" : ""].filter(Boolean).join(" ")}
                    d={p.d}
                    aria-label={prefName(p.code)}
                    onClick={() => setSelected(p.code)}
                  />
                ))}
            </g>
            <g class="jp-land-glow">
              {layout.paths
                .filter((p) => visited.has(p.code))
                .map((p) => (
                  <path
                    key={p.code}
                    class={[
                      "jp-pref",
                      "jp-pref--visited",
                      revealing.has(p.code) ? "jp-pref--revealing" : "",
                      selected === p.code ? "jp-pref--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    d={p.d}
                    aria-label={prefName(p.code)}
                    onClick={() => setSelected(p.code)}
                  />
                ))}
            </g>
            {revealBursts.map((b) => (
              <g key={b.code} class="map-reveal-burst" aria-hidden="true" transform={`translate(${b.x}, ${b.y})`}>
                <circle class="map-reveal-burst__ripple" r={6} />
                <circle class="map-reveal-burst__ripple map-reveal-burst__ripple--late" r={6} />
                <path class="map-reveal-burst__star" d="M0,-14 L3,-3 L14,0 L3,3 L0,14 L-3,3 L-14,0 L-3,-3 Z" />
              </g>
            ))}
          </svg>
        )}

        {selectedPref && (
          <div class="panel jp-selected">
            <div class="jp-selected__head">
              <h2 class="jp-selected__name">{lang === "ja" ? selectedPref.name_ja : selectedPref.name}</h2>
              <span class={`jp-rarity jp-rarity--${rarityOf(selectedPref.code)}`}>
                {t(`map.jp.rarity.${rarityOf(selectedPref.code)}`)}
              </span>
              <button type="button" class="btn btn-icon" onClick={() => setSelected(null)} aria-label={t("map.sheet.cancel")}>
                <X size={18} />
              </button>
            </div>
            <p class="jp-selected__sub">
              {lang === "ja" ? selectedPref.name : selectedPref.name_ja} · {selectedPref.code}
            </p>
            <p class={["jp-selected__state", visited.has(selectedPref.code) ? "jp-selected__state--visited" : ""].filter(Boolean).join(" ")}>
              {visited.has(selectedPref.code) ? t("map.jp.visitedState") : t("map.jp.unvisitedState")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

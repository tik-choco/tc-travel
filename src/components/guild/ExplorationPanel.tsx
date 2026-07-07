import "./guild.i18n";
import "./exploration.css";
import { Compass, Globe } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { getLanguage, useT } from "../../lib/i18n";
import { useExplorationStats } from "../../lib/explorationStats";

/** How many coverage rows show before the long tail folds behind "show all". */
const COLLAPSED_ROWS = 5;

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** ISO alpha-2 (lowercase) -> regional-indicator flag emoji; 🌐 for anything odd. */
function flagEmoji(cc: string): string {
  if (!/^[a-z]{2}$/.test(cc)) return "🌐";
  const RI_A = 0x1f1e6;
  return String.fromCodePoint(RI_A + cc.charCodeAt(0) - 97, RI_A + cc.charCodeAt(1) - 97);
}

/** Gentle count-up toward `target` when it rises (background resolutions landing).
 *  Mounts at the current value — no fake 0→N replay — and snaps instantly when
 *  the user prefers reduced motion or the value goes down (point removed). */
function useCountUp(target: number): number {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (target === from) return;
    if (target < from || prefersReducedMotion()) {
      setDisplay(target);
      return;
    }
    const start = performance.now();
    const duration = Math.min(900, 300 + (target - from) * 60);
    let raf = requestAnimationFrame(function step(now: number) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return display;
}

/** Exploration panel: how much of the world this traveler has made theirs, at the
 *  municipality unit. World lens is a celebratory COUNT ("N municipalities · M
 *  countries") — never a world % (it would round to ~0 forever, see
 *  lib/explorationStats.ts). Domestic lens is per-country coverage rows
 *  (visited / total + slim bar), richest first. Renders instantly with whatever
 *  is resolved; `resolving` only adds a soft "counting…" hint. */
export function ExplorationPanel() {
  const t = useT();
  const lang = getLanguage();
  const { municipalitiesVisited, countriesVisited, perCountry, resolving } = useExplorationStats();

  const muniDisplay = useCountUp(municipalitiesVisited);

  // One-shot shimmer on the hero number when it rises. Gated in JS too: with
  // reduced motion the CSS animation never runs, so animationend would never
  // clear the class and later rises couldn't re-trigger it.
  const [bumping, setBumping] = useState(false);
  const prevMunis = useRef(municipalitiesVisited);
  useEffect(() => {
    if (municipalitiesVisited > prevMunis.current && !prefersReducedMotion()) setBumping(true);
    prevMunis.current = municipalitiesVisited;
  }, [municipalitiesVisited]);

  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? perCountry : perCountry.slice(0, COLLAPSED_ROWS);

  const empty = municipalitiesVisited === 0 && countriesVisited === 0 && !resolving;

  return (
    <section class="panel explore-panel">
      <h2 class="title-ornate guild-section-title">{t("explore.title")}</h2>

      {empty ? (
        <div class="explore-empty">
          <Compass size={28} aria-hidden="true" class="explore-empty-icon" />
          <p>{t("explore.empty")}</p>
        </div>
      ) : (
        <>
          <div class="explore-hero">
            <div class="explore-hero-row">
              <span
                class={`explore-hero-count${bumping ? " explore-hero-count-bump" : ""}`}
                onAnimationEnd={() => setBumping(false)}
              >
                {muniDisplay.toLocaleString(lang)}
              </span>
              <span class="explore-hero-unit">{t("explore.muniUnit")}</span>
            </div>
            <p class="explore-hero-caption">{t("explore.heroCaption")}</p>
            <div class="explore-hero-meta">
              <span class="explore-countries-chip">
                <Globe size={14} aria-hidden="true" />
                {t("explore.countriesCount", { count: countriesVisited })}
              </span>
              {resolving && (
                <span class="explore-resolving">
                  <span class="explore-resolving-dot" aria-hidden="true" />
                  {t("explore.resolving")}
                </span>
              )}
            </div>
          </div>

          {rows.length > 0 && (
            <div class="explore-countries">
              <h3 class="explore-depth-title">{t("explore.depthTitle")}</h3>
              {rows.map((c) => {
                const pct =
                  c.total > 0
                    ? Math.min(100, Math.max((c.visited / c.total) * 100, c.visited > 0 ? 2 : 0))
                    : 0;
                const countText =
                  c.total > 0
                    ? `${c.visited.toLocaleString(lang)} / ${c.total.toLocaleString(lang)}`
                    : c.visited > 0
                      ? c.visited.toLocaleString(lang)
                      : "—";
                return (
                  <div class="explore-row" key={c.cc}>
                    <span class="explore-row-flag" aria-hidden="true">
                      {flagEmoji(c.cc)}
                    </span>
                    <span class="explore-row-name">{c.name}</span>
                    <span class="explore-row-count">{countText}</span>
                    <div class="explore-row-bar" aria-hidden="true">
                      <div class="explore-row-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {perCountry.length > COLLAPSED_ROWS && (
                <button
                  type="button"
                  class="btn btn-ghost explore-more-btn"
                  onClick={() => setExpanded((e) => !e)}
                >
                  {expanded ? t("explore.showLess") : t("explore.showAll", { count: perCountry.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useState } from "preact/hooks";
import type { AchievementDef, JourneyStats } from "../../lib/types";
import { useT } from "../../lib/i18n";
import { ACHIEVEMENTS } from "../../lib/gamification";
import { tOrNull, tWithFallback } from "./fallback";

interface AchievementsGridProps {
  stats: JourneyStats;
}

/** Grid of every AchievementDef: unlocked = gold-framed with its icon, locked = darkened
 * silhouette with a lock. Tapping a tile opens a detail sheet with the full title/desc. */
export function AchievementsGrid({ stats }: AchievementsGridProps) {
  const t = useT();
  const [selected, setSelected] = useState<AchievementDef | null>(null);
  const unlockedCount = ACHIEVEMENTS.filter((def) => def.achieved(stats)).length;

  return (
    <section class="panel guild-achievements">
      <h2 class="title-ornate guild-section-title">{t("ach.title")}</h2>
      <p class="ach-progress">{t("ach.progress", { unlocked: unlockedCount, total: ACHIEVEMENTS.length })}</p>
      <div class="ach-grid">
        {ACHIEVEMENTS.map((def) => {
          const unlocked = def.achieved(stats);
          const title = tWithFallback(t, def.titleKey, def.id);
          return (
            <button
              type="button"
              key={def.id}
              class={`ach-tile ${unlocked ? "ach-tile-unlocked" : "ach-tile-locked"}`}
              onClick={() => setSelected(def)}
              aria-label={title}
            >
              <span class="ach-tile-icon" aria-hidden="true">
                {unlocked ? def.icon : "🔒"}
              </span>
              <span class="ach-tile-title">{title}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div class="ach-sheet-backdrop" onClick={() => setSelected(null)}>
          <div class="ach-sheet panel" onClick={(e) => e.stopPropagation()}>
            <span class="ach-sheet-icon" aria-hidden="true">
              {selected.achieved(stats) ? selected.icon : "🔒"}
            </span>
            <h3 class="ach-sheet-title">{tWithFallback(t, selected.titleKey, selected.id)}</h3>
            {tOrNull(t, selected.descKey) && <p class="ach-sheet-desc">{tOrNull(t, selected.descKey)}</p>}
            {!selected.achieved(stats) && <p class="ach-sheet-locked">{t("ach.locked")}</p>}
            <button type="button" class="btn" onClick={() => setSelected(null)}>
              {t("ach.close")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

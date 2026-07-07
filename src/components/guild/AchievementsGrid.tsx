import { useState } from "preact/hooks";
import { Lock, Target } from "lucide-preact";
import type { AchievementDef, JourneyStats } from "../../lib/types";
import { useT } from "../../lib/i18n";
import { ACHIEVEMENTS, nextGoal } from "../../lib/gamification";
import { tOrNull, tWithFallback } from "./fallback";

interface AchievementsGridProps {
  stats: JourneyStats;
}

/** Grid of every AchievementDef: unlocked = primary-container tile with its icon,
 * locked = outlined tile at reduced opacity with a lock hint (plus a progress
 * meter for countable ones, so "just one more" is always visible). A "next goal"
 * banner surfaces the closest unmet achievement. Tapping a tile opens a detail
 * sheet with the full title/desc. */
export function AchievementsGrid({ stats }: AchievementsGridProps) {
  const t = useT();
  const [selected, setSelected] = useState<AchievementDef | null>(null);
  const unlockedCount = ACHIEVEMENTS.filter((def) => def.achieved(stats)).length;
  const goal = nextGoal(stats);

  return (
    <section class="panel guild-achievements">
      <h2 class="title-ornate guild-section-title">{t("ach.title")}</h2>
      <p class="ach-progress">{t("ach.progress", { unlocked: unlockedCount, total: ACHIEVEMENTS.length })}</p>

      {goal && (
        <button
          type="button"
          class="ach-next-goal"
          onClick={() => setSelected(goal.def)}
          aria-label={tWithFallback(t, goal.def.titleKey, goal.def.id)}
        >
          <span class="ach-next-goal-icon" aria-hidden="true">
            <Target size={16} />
          </span>
          <span class="ach-next-goal-body">
            <span class="ach-next-goal-label">
              {t("guild.nextGoal")} · {t("guild.nextGoalRemaining", { remaining: goal.remaining })}
            </span>
            <span class="ach-next-goal-title">{tWithFallback(t, goal.def.titleKey, goal.def.id)}</span>
            <span class="ach-meter" aria-hidden="true">
              <span class="ach-meter-fill" style={{ width: `${Math.round((goal.have / goal.need) * 100)}%` }} />
            </span>
          </span>
        </button>
      )}

      <div class="ach-grid">
        {ACHIEVEMENTS.map((def) => {
          const unlocked = def.achieved(stats);
          const title = tWithFallback(t, def.titleKey, def.id);
          const meter = !unlocked && def.progress ? def.progress(stats) : null;
          return (
            <button
              type="button"
              key={def.id}
              class={`ach-tile ${unlocked ? "ach-tile-unlocked" : "ach-tile-locked"}`}
              onClick={() => setSelected(def)}
              aria-label={title}
            >
              <span class="ach-tile-icon" aria-hidden="true">
                {unlocked ? def.icon : <Lock size={20} />}
              </span>
              <span class="ach-tile-title">{title}</span>
              {meter && meter.have > 0 && (
                <span class="ach-meter" aria-hidden="true">
                  <span class="ach-meter-fill" style={{ width: `${Math.round((meter.have / meter.need) * 100)}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div class="modal-backdrop" onClick={() => setSelected(null)}>
          <div class="modal-card ach-sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            <span class="ach-sheet-icon" aria-hidden="true">
              {selected.achieved(stats) ? selected.icon : <Lock size={32} />}
            </span>
            <h3 class="ach-sheet-title">{tWithFallback(t, selected.titleKey, selected.id)}</h3>
            {tOrNull(t, selected.descKey) && <p class="ach-sheet-desc">{tOrNull(t, selected.descKey)}</p>}
            {!selected.achieved(stats) &&
              (selected.progress ? (
                (() => {
                  const p = selected.progress(stats);
                  return (
                    <div class="ach-sheet-progress">
                      <span class="ach-meter" aria-hidden="true">
                        <span class="ach-meter-fill" style={{ width: `${Math.round((p.have / p.need) * 100)}%` }} />
                      </span>
                      <span class="ach-sheet-progress-label">
                        {p.have} / {p.need}
                      </span>
                    </div>
                  );
                })()
              ) : (
                <p class="ach-sheet-locked">{t("ach.locked")}</p>
              ))}
            <button type="button" class="btn" onClick={() => setSelected(null)}>
              {t("ach.close")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

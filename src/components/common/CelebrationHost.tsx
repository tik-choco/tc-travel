import "./celebrate.i18n";
import "./celebrate.css";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useT } from "../../lib/i18n";
import { useJourneyStats } from "../../lib/journeyStats";
import { ACHIEVEMENTS } from "../../lib/gamification";
import { UNLOCKS, tierDef, unlockTiers } from "../../lib/unlocks";
import {
  diffLedger,
  hasCelebrations,
  loadLedger,
  saveLedger,
  type CelebrationLedger,
} from "../../lib/celebrate";
import { onTogether } from "../../lib/store";
import type { CelebrationEvent } from "../../lib/types";
import { tWithFallback } from "../guild/fallback";

// How long each burst lingers before auto-dismissing. Long enough to read a
// short line, short enough to not nag; tapping dismisses early.
const SHOW_MS = 3600;

/**
 * App-wide reward layer. Watches the derived journey state and, whenever it
 * crosses a threshold (level up, achievement unlock, streak milestone), shows a
 * brief congratulatory burst. Mounted once at the app root so a reward earned on
 * any tab — or discovered on the next launch — still gets its moment.
 */
export function CelebrationHost() {
  const t = useT();
  const { stats, rank, japanSettled } = useJourneyStats();
  const [queue, setQueue] = useState<CelebrationEvent[]>([]);
  const [current, setCurrent] = useState<CelebrationEvent | null>(null);

  const unlockedIds = useMemo(() => ACHIEVEMENTS.filter((a) => a.achieved(stats)).map((a) => a.id), [stats]);
  const unlocks = useMemo(() => unlockTiers(stats), [stats]);
  // Cheap fingerprint of everything that can trigger a burst, so the diff runs
  // only when the derived state actually changes — not on every render.
  const unlockFp = UNLOCKS.map((u) => unlocks[u.id]).join(",");
  const fingerprint = `${japanSettled}|${rank.level}|${stats.longestStreakDays}|${unlockedIds.join(",")}|${unlockFp}`;

  useEffect(() => {
    // Wait until Japan prefecture credit has settled: a late async load must not
    // fire a false "unlocked" for a prefecture achievement the user already had.
    if (!japanSettled) return;
    const next: CelebrationLedger = {
      level: rank.level,
      achievements: unlockedIds,
      // Feed the high-water mark, not the live streak: a milestone fires once
      // when your best-ever run first crosses it, and never re-fires when a
      // broken streak is rebuilt back up to the same length.
      streakDays: stats.longestStreakDays,
      unlocks,
    };
    const delta = diffLedger(loadLedger(), next);
    saveLedger(next); // advance the baseline whether we seed or celebrate
    if (!hasCelebrations(delta)) return;

    const events: CelebrationEvent[] = [];
    // Progressive unlocks read in the app's warm, second-person voice — the
    // companion noticing, never "Unlocked!". Reuse the "achievement" burst
    // styling so no shared type (types.ts CelebrationEvent) has to change.
    for (const u of delta.newUnlocks) {
      const def = UNLOCKS.find((d) => d.id === u.id);
      const td = tierDef(u.id, u.tier);
      if (!def || !td) continue;
      events.push({
        kind: "achievement",
        icon: def.icon,
        title: t(td.celebrateKey),
        detail: t(`${td.celebrateKey}.detail`),
      });
    }
    for (const id of delta.newAchievementIds) {
      const def = ACHIEVEMENTS.find((a) => a.id === id);
      if (!def) continue;
      events.push({
        kind: "achievement",
        icon: def.icon,
        title: tWithFallback(t, def.titleKey, def.id),
        detail: t("celebrate.achievementUnlocked"),
      });
    }
    for (const days of delta.streakMilestones) {
      events.push({ kind: "streak", icon: "\u{1F525}", title: t("celebrate.streak", { days }), detail: t("celebrate.streakDetail") });
    }
    if (delta.leveledUpTo !== null) {
      events.push({ kind: "level", icon: "⭐", title: t("celebrate.level", { level: delta.leveledUpTo }), detail: t(rank.titleKey) });
    }
    if (events.length) setQueue((q) => [...q, ...events]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint captures every value read above
  }, [fingerprint]);

  // The "you're together" greeting: fired by store.ts on the 0→>0 peer
  // transition (once per roomId per launch — a greeting, not an award, so it
  // deliberately repeats across launches). Reuses the "achievement" burst
  // styling, same as progressive unlocks above, so no shared type changes.
  useEffect(
    () =>
      onTogether(() => {
        setQueue((q) => [
          ...q,
          {
            kind: "achievement",
            icon: "\u{1F91D}",
            title: t("celebrate.together"),
            detail: t("celebrate.together.detail"),
          },
        ]);
      }),
    [t],
  );

  // Promote the next queued burst once the stage is free.
  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
  }, [current, queue]);

  // Auto-dismiss the visible burst.
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;
  return (
    <div class="celebrate-layer" role="status" aria-live="polite">
      <button
        type="button"
        class={`celebrate-card celebrate-${current.kind}`}
        onClick={() => setCurrent(null)}
        aria-label={t("common.close")}
      >
        <span class="celebrate-icon" aria-hidden="true">
          {current.icon}
        </span>
        <span class="celebrate-text">
          <span class="celebrate-title">{current.title}</span>
          {current.detail && <span class="celebrate-detail">{current.detail}</span>}
        </span>
      </button>
    </div>
  );
}

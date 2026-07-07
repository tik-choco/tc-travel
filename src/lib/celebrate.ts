// The "you just crossed a threshold" detector behind the CelebrationHost.
//
// Every reward in tc-travel is DERIVED from journey stats (see gamification.ts),
// so there is no natural "event" when you level up or unlock an achievement —
// a number simply changes on a screen you may not be looking at. This module
// reconstructs those moments by persisting a tiny "last celebrated" ledger and
// diffing the freshly-derived state against it.
//
// The load-bearing rule: when NO prior ledger exists (first run of this feature,
// or a returning user's first open after it ships) we record the baseline and
// celebrate NOTHING — otherwise a user who already earned ten achievements would
// be buried in false "Unlocked!" bursts. History is seeded, never celebrated.
//
// Pure diff + localStorage persistence only; the host localizes and renders.

export interface CelebrationLedger {
  /** rank level last seen */
  level: number;
  /** ids of achievements last seen as unlocked */
  achievements: string[];
  /** streak day-count last seen (to detect milestone crossings) */
  streakDays: number;
}

export interface CelebrationDelta {
  /** the new level if it went up since last time, else null */
  leveledUpTo: number | null;
  /** achievement ids unlocked since last time */
  newAchievementIds: string[];
  /** streak milestones (in days) newly reached since last time */
  streakMilestones: number[];
}

/** Streak lengths worth a fanfare — mirrors the weekStreak/monthStreak achievements. */
export const STREAK_MILESTONES: readonly number[] = [7, 30];

/**
 * Compares the freshly-derived ledger against the last-celebrated one.
 * `prev === null` means we've never recorded a baseline: seed silently by
 * returning an empty delta (the caller then persists `next`).
 */
export function diffLedger(prev: CelebrationLedger | null, next: CelebrationLedger): CelebrationDelta {
  if (!prev) return { leveledUpTo: null, newAchievementIds: [], streakMilestones: [] };
  const prevAchieved = new Set(prev.achievements);
  return {
    leveledUpTo: next.level > prev.level ? next.level : null,
    newAchievementIds: next.achievements.filter((id) => !prevAchieved.has(id)),
    // fire a milestone only on the crossing (prev below, next at/above), so it
    // never re-celebrates and a broken-then-rebuilt streak celebrates again
    streakMilestones: STREAK_MILESTONES.filter((m) => next.streakDays >= m && prev.streakDays < m),
  };
}

export function hasCelebrations(d: CelebrationDelta): boolean {
  return d.leveledUpTo !== null || d.newAchievementIds.length > 0 || d.streakMilestones.length > 0;
}

// --- persistence -------------------------------------------------------------

const LEDGER_KEY = "tc-travel:celebLedger";

export function loadLedger(): CelebrationLedger | null {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    return raw ? (JSON.parse(raw) as CelebrationLedger) : null;
  } catch {
    return null;
  }
}

export function saveLedger(ledger: CelebrationLedger): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // storage unavailable (private mode) — celebrations just won't persist
    // across reloads; harmless, and diffing within a session still works.
  }
}

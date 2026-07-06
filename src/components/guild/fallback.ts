// Graceful-degradation helpers for translation lookups. If a translation key isn't
// registered yet (e.g. the core agent's AchievementDef ids or rank titleKeys drift from
// what guild.i18n.ts anticipated), `translate()` returns the raw key. Showing a raw
// dotted key like "ach.firstSteps.title" to the user looks broken, so these helpers
// substitute something readable instead.

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** "firstSteps" -> "First Steps", "monthStreak30" -> "Month Streak 30". */
export function idToTitleCase(id: string): string {
  const spaced = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Translates `key`; falls back to a title-cased `fallbackId` when `key` has no entry. */
export function tWithFallback(t: Translate, key: string, fallbackId: string): string {
  const value = t(key);
  return value === key ? idToTitleCase(fallbackId) : value;
}

/** Translates `key`; returns null (instead of the raw key) when there's no entry. */
export function tOrNull(t: Translate, key: string): string | null {
  const value = t(key);
  return value === key ? null : value;
}

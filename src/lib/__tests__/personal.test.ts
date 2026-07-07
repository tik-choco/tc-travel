import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { longestStreakDays, touchStreak } from "../personal";

const STREAK_KEY = "tc-travel:streak";

/** Minimal in-memory localStorage stand-in for the node test environment. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** Pin "now" to noon local time on the given date, so dayKey() is unambiguous. */
function onDay(iso: string): void {
  vi.setSystemTime(new Date(`${iso}T12:00:00`));
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("streak high-water mark (touchStreak / longestStreakDays)", () => {
  it("ratchets `longest` up with the run and never down on a lapse", () => {
    onDay("2026-07-01");
    touchStreak();
    onDay("2026-07-02");
    touchStreak();
    onDay("2026-07-03");
    touchStreak();
    expect(longestStreakDays()).toBe(3);

    // Lapse: several days missed — the live count resets, the mark holds.
    onDay("2026-07-10");
    touchStreak();
    const saved = JSON.parse(localStorage.getItem(STREAK_KEY)!) as { count: number; longest: number };
    expect(saved.count).toBe(1);
    expect(saved.longest).toBe(3);
    expect(longestStreakDays()).toBe(3);

    // Rebuilding past the old mark ratchets it up again.
    onDay("2026-07-11");
    touchStreak();
    onDay("2026-07-12");
    touchStreak();
    onDay("2026-07-13");
    touchStreak();
    onDay("2026-07-14");
    touchStreak();
    expect(longestStreakDays()).toBe(5);
  });

  it("is idempotent within a day (a second touch neither bumps count nor longest)", () => {
    onDay("2026-07-01");
    touchStreak();
    touchStreak();
    expect(longestStreakDays()).toBe(1);
  });

  it("migrates a legacy ACTIVE streak with no `longest` via the live-count max", () => {
    onDay("2026-07-01");
    localStorage.setItem(STREAK_KEY, JSON.stringify({ lastActiveDay: "2026-07-01", count: 12 }));
    // longest is absent (?? 0), but the max against the live streak reports it.
    expect(longestStreakDays()).toBe(12);
  });

  it("migrates a legacy LAPSED streak on the next app-open touch, preserving the old run", () => {
    localStorage.setItem(STREAK_KEY, JSON.stringify({ lastActiveDay: "2026-06-01", count: 30 }));
    onDay("2026-07-01");
    // touchStreak runs on app start: it seeds `longest` from the old persisted
    // count BEFORE resetting the live run, so the 30-day record survives.
    touchStreak();
    expect(longestStreakDays()).toBe(30);
    const saved = JSON.parse(localStorage.getItem(STREAK_KEY)!) as { count: number; longest: number };
    expect(saved.count).toBe(1);
    expect(saved.longest).toBe(30);
  });
});

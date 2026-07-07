import { describe, expect, it } from "vitest";
import { diffLedger, hasCelebrations, type CelebrationLedger } from "../celebrate";

const ledger = (o: Partial<CelebrationLedger> = {}): CelebrationLedger => ({
  level: 1,
  achievements: [],
  streakDays: 0,
  ...o,
});

describe("diffLedger", () => {
  it("seeds silently: no prior ledger celebrates nothing", () => {
    const d = diffLedger(null, ledger({ level: 8, achievements: ["a", "b", "c"], streakDays: 30 }));
    expect(hasCelebrations(d)).toBe(false);
    expect(d).toEqual({ leveledUpTo: null, newAchievementIds: [], streakMilestones: [] });
  });

  it("detects a level up but not a level that held steady", () => {
    expect(diffLedger(ledger({ level: 3 }), ledger({ level: 4 })).leveledUpTo).toBe(4);
    expect(diffLedger(ledger({ level: 4 }), ledger({ level: 4 })).leveledUpTo).toBeNull();
    // level can never regress in practice, but a stale ledger must not "celebrate" downward
    expect(diffLedger(ledger({ level: 5 }), ledger({ level: 4 })).leveledUpTo).toBeNull();
  });

  it("reports only the newly-unlocked achievements", () => {
    const d = diffLedger(ledger({ achievements: ["firstSteps"] }), ledger({ achievements: ["firstSteps", "japan10", "namecard1"] }));
    expect(d.newAchievementIds).toEqual(["japan10", "namecard1"]);
  });

  it("fires a streak milestone once, only on the crossing", () => {
    expect(diffLedger(ledger({ streakDays: 6 }), ledger({ streakDays: 7 })).streakMilestones).toEqual([7]);
    // already past it -> silent
    expect(diffLedger(ledger({ streakDays: 7 }), ledger({ streakDays: 8 })).streakMilestones).toEqual([]);
    // a fresh run to 30 crosses only the 30 mark (7 was crossed long ago)
    expect(diffLedger(ledger({ streakDays: 29 }), ledger({ streakDays: 30 })).streakMilestones).toEqual([30]);
    // a broken-then-rebuilt streak celebrates the 7 crossing again
    expect(diffLedger(ledger({ streakDays: 0 }), ledger({ streakDays: 7 })).streakMilestones).toEqual([7]);
  });

  it("reports nothing when nothing changed", () => {
    const same = ledger({ level: 5, achievements: ["a"], streakDays: 10 });
    expect(hasCelebrations(diffLedger(same, { ...same }))).toBe(false);
  });
});

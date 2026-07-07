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
    expect(d).toEqual({ leveledUpTo: null, newAchievementIds: [], streakMilestones: [], newUnlocks: [] });
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

describe("diffLedger — progressive unlocks", () => {
  it("seeds silently when the prior ledger predates unlocks (no unlocks field)", () => {
    // A returning user whose ledger was written before this feature shipped must
    // not get a retroactive burst for tiers they already earned.
    const prev = ledger({ level: 3, achievements: ["a"] }); // no `unlocks`
    const d = diffLedger(prev, ledger({ level: 3, achievements: ["a"], unlocks: { lensFilters: 2, companionWake: 1 } }));
    expect(d.newUnlocks).toEqual([]);
    expect(hasCelebrations(d)).toBe(false);
  });

  it("celebrates a genuine tier crossing once a baseline exists", () => {
    const prev = ledger({ unlocks: { lensFilters: 1, cardMotifs: 0 } });
    const d = diffLedger(prev, ledger({ unlocks: { lensFilters: 2, cardMotifs: 1 } }));
    expect(d.newUnlocks).toEqual([
      { id: "lensFilters", tier: 2 },
      { id: "cardMotifs", tier: 1 },
    ]);
    expect(hasCelebrations(d)).toBe(true);
  });

  it("treats an unlock absent from the prior baseline as tier 0 (first crossing celebrates)", () => {
    const prev = ledger({ unlocks: { lensFilters: 1 } });
    const d = diffLedger(prev, ledger({ unlocks: { lensFilters: 1, companionWake: 1 } }));
    expect(d.newUnlocks).toEqual([{ id: "companionWake", tier: 1 }]);
  });

  it("reports the highest reached tier per unlock (a multi-tier jump is one moment)", () => {
    const prev = ledger({ unlocks: { lensFilters: 0 } });
    const d = diffLedger(prev, ledger({ unlocks: { lensFilters: 3 } }));
    expect(d.newUnlocks).toEqual([{ id: "lensFilters", tier: 3 }]);
  });

  it("stays silent when tiers held steady", () => {
    const same = ledger({ unlocks: { lensFilters: 2, cardMotifs: 1 } });
    expect(diffLedger(same, { ...same }).newUnlocks).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  UNLOCKS,
  availableLensFilters,
  nextUnlock,
  tierDef,
  unlockTiers,
  unlockedTier,
  LENS_FILTERS,
} from "../unlocks";
import type { JourneyStats } from "../types";

function stats(overrides: Partial<JourneyStats> = {}): JourneyStats {
  return {
    countriesVisited: [],
    companionsMet: [],
    photoCount: 0,
    arPhotoCount: 0,
    diaryCount: 0,
    pinCount: 0,
    roomCount: 0,
    streakDays: 0,
    longestStreakDays: 0,
    cardsCollected: 0,
    prefecturesVisited: 0,
    ...overrides,
  };
}

const byId = (id: string) => UNLOCKS.find((u) => u.id === id)!;

describe("companionWake", () => {
  const def = byId("companionWake");
  it("stays asleep with no journey activity", () => {
    expect(unlockedTier(def, stats())).toBe(0);
  });
  it("wakes on the first pin, photo OR diary entry (the firstSteps signal)", () => {
    expect(unlockedTier(def, stats({ pinCount: 1 }))).toBe(1);
    expect(unlockedTier(def, stats({ photoCount: 1 }))).toBe(1);
    expect(unlockedTier(def, stats({ diaryCount: 1 }))).toBe(1);
  });
});

describe("lensFilters tiers on photoCount", () => {
  const def = byId("lensFilters");
  const cases: [number, number][] = [
    [0, 0],
    [9, 0],
    [10, 1],
    [24, 1],
    [25, 2],
    [49, 2],
    [50, 3],
    [999, 3],
  ];
  it.each(cases)("photoCount=%i -> tier %i", (photoCount, tier) => {
    expect(unlockedTier(def, stats({ photoCount }))).toBe(tier);
  });
});

describe("cardMotifs tiers on cardsCollected", () => {
  const def = byId("cardMotifs");
  const cases: [number, number][] = [
    [0, 0],
    [1, 1],
    [9, 1],
    [10, 2],
    [50, 2],
  ];
  it.each(cases)("cardsCollected=%i -> tier %i", (cardsCollected, tier) => {
    expect(unlockedTier(def, stats({ cardsCollected }))).toBe(tier);
  });
});

describe("unlockTiers", () => {
  it("returns a tier for every registered unlock", () => {
    const tiers = unlockTiers(stats({ photoCount: 25, cardsCollected: 1, pinCount: 1 }));
    expect(tiers).toEqual({ companionWake: 1, lensFilters: 2, cardMotifs: 1 });
  });
  it("is all-zero for a brand-new traveller", () => {
    expect(unlockTiers(stats())).toEqual({ companionWake: 0, lensFilters: 0, cardMotifs: 0 });
  });
});

describe("availableLensFilters", () => {
  it("offers only 'none' at tier 0", () => {
    expect(availableLensFilters(0).map((f) => f.id)).toEqual(["none"]);
  });
  it("adds one filter per unlocked tier, in order", () => {
    expect(availableLensFilters(1).map((f) => f.id)).toEqual(["none", "golden"]);
    expect(availableLensFilters(2).map((f) => f.id)).toEqual(["none", "golden", "film"]);
    expect(availableLensFilters(3).map((f) => f.id)).toEqual(["none", "golden", "film", "lantern"]);
  });
  it("every non-default filter carries a non-empty CSS filter string", () => {
    for (const f of LENS_FILTERS) {
      if (f.id === "none") expect(f.css).toBe("");
      else expect(f.css.length).toBeGreaterThan(0);
    }
  });
});

describe("nextUnlock", () => {
  it("points at the companion waking for a brand-new traveller (1 step away)", () => {
    const n = nextUnlock(stats());
    expect(n?.def.id).toBe("companionWake");
    expect(n?.tier.tier).toBe(1);
    expect(n?.remaining).toBe(1);
  });

  it("PRIORITIZES the still-asleep companion over any numeric unlock, even one just as close", () => {
    // A user who's collected cards (cardMotifs already tier 1, next tier 9 away)
    // but never made a pin/photo/diary entry — companionWake is still tier 0.
    // Its unit-mismatched "distance" must not lose to card/photo distances.
    const n = nextUnlock(stats({ cardsCollected: 3, photoCount: 0, pinCount: 0, diaryCount: 0 }));
    expect(n?.def.id).toBe("companionWake");
  });

  it("falls back to the nearest numeric unlock once the companion has woken", () => {
    // companion already woken (a pin); 8 photos (2 from golden) vs 0 cards (1
    // from first card). A room has been joined (social signal), so the nearer
    // card unlock wins.
    const n = nextUnlock(stats({ pinCount: 1, photoCount: 8, cardsCollected: 0, roomCount: 1 }));
    expect(n?.def.id).toBe("cardMotifs");
    expect(n?.remaining).toBe(1);
  });

  it("advances to the next tier of the same unlock once a lower tier is met", () => {
    const n = nextUnlock(stats({ pinCount: 1, photoCount: 26, cardsCollected: 10 }));
    // photos past golden(10)+film(25); next is lantern(50), 24 away — the only
    // unlock with a tier left, so it's chosen.
    expect(n?.def.id).toBe("lensFilters");
    expect(n?.tier.upcomingKey).toBe("unlock.upcoming.lantern");
    expect(n?.remaining).toBe(24);
  });

  it("returns null when every unlock tier is maxed out", () => {
    expect(nextUnlock(stats({ pinCount: 1, photoCount: 50, cardsCollected: 10 }))).toBeNull();
  });

  it("does NOT whisper cardMotifs to a purely-solo traveller (no social signal)", () => {
    // Companion woken (a pin), 8 photos (golden 2 away), but zero cards and zero
    // rooms — cardMotifs (1 away) is suppressed, so the lens filter wins instead.
    const n = nextUnlock(stats({ pinCount: 1, photoCount: 8 }));
    expect(n?.def.id).toBe("lensFilters");
  });

  it("returns null for a solo traveller whose lens is maxed (Home falls back to the goal line)", () => {
    // Every lens tier earned, cardMotifs suppressed (no cards, no rooms) —
    // nothing left to whisper about.
    expect(nextUnlock(stats({ pinCount: 1, photoCount: 50 }))).toBeNull();
  });

  it("whispers cardMotifs once a social signal exists (e.g. a joined room)", () => {
    const n = nextUnlock(stats({ pinCount: 1, photoCount: 8, roomCount: 1 }));
    expect(n?.def.id).toBe("cardMotifs");
    expect(n?.remaining).toBe(1);
  });

  it("does not treat self-authored companion names as a social signal", () => {
    const n = nextUnlock(stats({ pinCount: 1, photoCount: 8, companionsMet: ["Mai"] }));
    expect(n?.def.id).toBe("lensFilters");
  });
});

describe("tierDef", () => {
  it("resolves the celebration key for a given unlock + tier", () => {
    expect(tierDef("lensFilters", 1)?.celebrateKey).toBe("unlock.lens.golden");
    expect(tierDef("lensFilters", 3)?.celebrateKey).toBe("unlock.lens.lantern");
    expect(tierDef("companionWake", 1)?.celebrateKey).toBe("unlock.companionWake");
  });
  it("returns undefined for an unknown id or tier", () => {
    expect(tierDef("nope", 1)).toBeUndefined();
    expect(tierDef("lensFilters", 9)).toBeUndefined();
  });
});

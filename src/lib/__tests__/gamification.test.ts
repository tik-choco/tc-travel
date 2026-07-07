import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, computeRank, computeStats, hasSocialSignal, nextGoal, xpForLevel } from "../gamification";
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

describe("computeStats", () => {
  it("dedupes countries across pins, photos and diary geo", () => {
    const result = computeStats({
      pins: [{ countryCode: "jp", companions: ["Alice", "Bob"] }],
      photos: [{ geo: { countryCode: "jp" }, arShot: false }, { geo: { countryCode: "fr" }, arShot: true }],
      diary: [{ geo: { countryCode: "de" } }, { geo: null }],
      streakDays: 3,
      longestStreakDays: 5,
      roomCount: 2,
    });
    expect(result.countriesVisited.sort()).toEqual(["de", "fr", "jp"]);
    expect(result.companionsMet).toEqual(["Alice", "Bob"]);
    expect(result.photoCount).toBe(2);
    expect(result.arPhotoCount).toBe(1);
    expect(result.diaryCount).toBe(2);
    expect(result.pinCount).toBe(1);
    expect(result.roomCount).toBe(2);
    expect(result.streakDays).toBe(3);
    expect(result.longestStreakDays).toBe(5);
    // cards/prefectures default to 0 when the snapshot omits them
    expect(result.cardsCollected).toBe(0);
    expect(result.prefecturesVisited).toBe(0);
  });

  it("ignores blank companion names", () => {
    const result = computeStats({
      pins: [{ countryCode: "", companions: ["  ", "", "Zoe"] }],
      photos: [],
      diary: [],
      streakDays: 0,
      longestStreakDays: 0,
      roomCount: 0,
    });
    expect(result.companionsMet).toEqual(["Zoe"]);
    expect(result.countriesVisited).toEqual([]);
  });

  it("threads collected cards and visited prefectures through", () => {
    const result = computeStats({
      pins: [],
      photos: [],
      diary: [],
      streakDays: 0,
      longestStreakDays: 0,
      roomCount: 0,
      cardsCollected: 4,
      prefecturesVisited: 12,
    });
    expect(result.cardsCollected).toBe(4);
    expect(result.prefecturesVisited).toBe(12);
  });
});

describe("xpForLevel", () => {
  it("is 0 at level 0 and strictly increasing", () => {
    expect(xpForLevel(0)).toBe(0);
    let prev = xpForLevel(0);
    for (let n = 1; n <= 30; n++) {
      const cur = xpForLevel(n);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe("computeRank", () => {
  it("starts at level 1 with zero xp", () => {
    const rank = computeRank(stats());
    expect(rank.level).toBe(1);
    expect(rank.xp).toBe(0);
    expect(rank.titleKey).toBe("rank.wanderer");
  });

  it("increases level as xp grows, and rank never regresses for more progress", () => {
    const low = computeRank(stats({ countriesVisited: ["jp"] }));
    const high = computeRank(stats({ countriesVisited: ["jp", "fr", "de", "us", "cn"], pinCount: 10, diaryCount: 10 }));
    expect(high.xp).toBeGreaterThan(low.xp);
    expect(high.level).toBeGreaterThanOrEqual(low.level);
  });

  it("xpIntoLevel is always within [0, xpForNextLevel)", () => {
    for (const countryCount of [0, 1, 3, 7, 12, 20]) {
      const rank = computeRank(stats({ countriesVisited: Array.from({ length: countryCount }, (_, i) => `c${i}`) }));
      expect(rank.xpIntoLevel).toBeGreaterThanOrEqual(0);
      expect(rank.xpIntoLevel).toBeLessThan(rank.xpForNextLevel);
    }
  });

  it("assigns rank titles by level band", () => {
    // 0 countries -> level 1 -> wanderer
    expect(computeRank(stats()).titleKey).toBe("rank.wanderer");
    // enough xp to comfortably clear into the legend band (level 15+ needs
    // xpForLevel(15) = 12000 cumulative xp)
    const legendary = computeRank(
      stats({ countriesVisited: Array.from({ length: 150 }, (_, i) => `c${i}`), companionsMet: Array.from({ length: 50 }, (_, i) => `p${i}`) }),
    );
    expect(legendary.level).toBeGreaterThanOrEqual(15);
    expect(legendary.titleKey).toBe("rank.legend");
  });
});

describe("ACHIEVEMENTS", () => {
  it("defines at least 12 achievements with unique ids and well-formed i18n keys", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(12);
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.titleKey).toBe(`ach.${a.id}.title`);
      expect(a.descKey).toBe(`ach.${a.id}.desc`);
      expect(a.icon.length).toBeGreaterThan(0);
    }
  });

  it("firstSteps triggers on any single recorded encounter, not before", () => {
    const firstSteps = ACHIEVEMENTS.find((a) => a.id === "firstSteps")!;
    expect(firstSteps.achieved(stats())).toBe(false);
    expect(firstSteps.achieved(stats({ pinCount: 1 }))).toBe(true);
    expect(firstSteps.achieved(stats({ photoCount: 1 }))).toBe(true);
    expect(firstSteps.achieved(stats({ diaryCount: 1 }))).toBe(true);
  });

  it("continental3 requires countries spread across at least 3 continents", () => {
    const continental3 = ACHIEVEMENTS.find((a) => a.id === "continental3")!;
    // jp+kr are both Asia -> only 1 continent
    expect(continental3.achieved(stats({ countriesVisited: ["jp", "kr"] }))).toBe(false);
    // jp (Asia), fr (Europe), us (Americas) -> 3 continents
    expect(continental3.achieved(stats({ countriesVisited: ["jp", "fr", "us"] }))).toBe(true);
  });

  it("portraitOfLegends requires at least one AR photo", () => {
    const portrait = ACHIEVEMENTS.find((a) => a.id === "portraitOfLegends")!;
    expect(portrait.achieved(stats({ photoCount: 5, arPhotoCount: 0 }))).toBe(false);
    expect(portrait.achieved(stats({ photoCount: 5, arPhotoCount: 1 }))).toBe(true);
  });

  it("rewards real-world meetings (cards) with their own achievements", () => {
    const namecard1 = ACHIEVEMENTS.find((a) => a.id === "namecard1")!;
    const namecard10 = ACHIEVEMENTS.find((a) => a.id === "namecard10")!;
    expect(namecard1.achieved(stats({ cardsCollected: 0 }))).toBe(false);
    expect(namecard1.achieved(stats({ cardsCollected: 1 }))).toBe(true);
    expect(namecard10.achieved(stats({ cardsCollected: 9 }))).toBe(false);
    expect(namecard10.achieved(stats({ cardsCollected: 10 }))).toBe(true);
  });

  it("feeds the Japan prefecture collection into the main economy", () => {
    const japanComplete = ACHIEVEMENTS.find((a) => a.id === "japanComplete")!;
    expect(japanComplete.achieved(stats({ prefecturesVisited: 46 }))).toBe(false);
    expect(japanComplete.achieved(stats({ prefecturesVisited: 47 }))).toBe(true);
    // completing all 47 prefectures grants meaningful XP, not just one country's
    expect(computeRank(stats({ prefecturesVisited: 47 })).xp).toBeGreaterThan(
      computeRank(stats({ prefecturesVisited: 0 })).xp,
    );
  });

  it("every countable achievement's progress agrees with its achieved() state", () => {
    for (const a of ACHIEVEMENTS) {
      if (!a.progress) continue;
      for (const s of [stats(), stats({ countriesVisited: ["jp", "fr", "us", "de", "cn"], diaryCount: 12, photoCount: 30, cardsCollected: 12, prefecturesVisited: 25, arPhotoCount: 6, pinCount: 15, roomCount: 6, companionsMet: ["a", "b", "c", "d", "e", "f"], streakDays: 40, longestStreakDays: 40 })]) {
        const { have, need } = a.progress(s);
        expect(have).toBeLessThanOrEqual(need); // meter never overfills
        expect(have >= need).toBe(a.achieved(s)); // full meter iff unlocked
      }
    }
  });
});

describe("nextGoal", () => {
  it("returns null when there is nothing left to chase", () => {
    // Real codes spanning all six continents (aq = Antarctica is the only way
    // to reach 6), padded with fakes purely to clear the 89-country threshold.
    const sixContinents = ["jp", "fr", "us", "za", "au", "aq"];
    const maxed = stats({
      countriesVisited: [...sixContinents, ...Array.from({ length: 84 }, (_, i) => `x${i}`)],
      companionsMet: Array.from({ length: 20 }, (_, i) => `p${i}`),
      cardsCollected: 20,
      prefecturesVisited: 47,
      diaryCount: 40,
      pinCount: 20,
      photoCount: 40,
      arPhotoCount: 10,
      roomCount: 10,
    });
    expect(nextGoal(maxed)).toBeNull();
  });

  it("returns the unmet non-streak goal with the fewest remaining", () => {
    const s = stats({
      countriesVisited: Array.from({ length: 9 }, (_, i) => `c${i}`),
      pinCount: 3,
      cardsCollected: 2,
      diaryCount: 4,
    });
    const goal = nextGoal(s);
    expect(goal).not.toBeNull();
    // it is genuinely unmet and its meter matches what it reports
    expect(goal!.def.achieved(s)).toBe(false);
    expect(goal!.need - goal!.have).toBe(goal!.remaining);
    // and no other unmet non-streak achievement is closer
    const STREAK = new Set(["weekStreak", "monthStreak"]);
    const minRemaining = Math.min(
      ...ACHIEVEMENTS.filter((a) => a.progress && !STREAK.has(a.id) && !a.achieved(s)).map((a) => {
        const p = a.progress!(s);
        return p.need - p.have;
      }),
    );
    expect(goal!.remaining).toBe(minRemaining);
  });

  it("never nudges toward a streak goal (can't be actioned right now)", () => {
    const nearStreak = nextGoal(stats({ streakDays: 6, diaryCount: 5, pinCount: 2 }));
    expect(nearStreak?.def.id).not.toBe("weekStreak");
    expect(nearStreak?.def.id).not.toBe("monthStreak");
  });

  it("does not nudge a purely-solo traveller toward a social goal", () => {
    // No cards, no rooms — namecard1 is 1 away and would otherwise win over
    // chronicler10 (also 1 away, but namecard1 sorts first at equal remaining).
    // With no social signal it's suppressed; the solo goal wins.
    const solo = nextGoal(stats({ diaryCount: 9 }));
    expect(solo?.def.id).toBe("chronicler10");
    for (const id of ["namecard1", "namecard10", "guildVeteran5"]) {
      expect(solo?.def.id).not.toBe(id);
    }
  });

  it("still nudges toward companion goals when solo (self-authored on pins)", () => {
    // fellowship5 / socialButterfly10 are deliberately NOT social-gated:
    // companion names are written by the traveller on their own pins.
    const solo = nextGoal(stats({ companionsMet: ["a", "b", "c", "d"], diaryCount: 1, pinCount: 1 }));
    expect(solo?.def.id).toBe("fellowship5");
  });

  it("surfaces card goals once cards prove a real-world meeting happened", () => {
    // Nothing changed but roomCount — namecard1 (1 away) is no longer suppressed
    // and beats chronicler10 (2 away).
    const viaRoom = nextGoal(stats({ diaryCount: 8, roomCount: 1 }));
    expect(viaRoom?.def.id).toBe("namecard1");
  });

  it("surfaces guildVeteran5 once a social signal exists", () => {
    // A card collected + 4 rooms joined: guildVeteran5 is uniquely 1 away.
    const s = stats({ cardsCollected: 1, roomCount: 4, pinCount: 1 });
    expect(nextGoal(s)?.def.id).toBe("guildVeteran5");
  });
});

describe("hasSocialSignal", () => {
  it("is false for a traveller who has only ever explored alone", () => {
    expect(hasSocialSignal(stats({ pinCount: 5, photoCount: 20, diaryCount: 8 }))).toBe(false);
  });
  it("ignores companion names — they're self-authored on pins, not proof of meeting", () => {
    expect(hasSocialSignal(stats({ companionsMet: ["Mai", "Ren"] }))).toBe(false);
  });
  it("is true after collecting a card or joining a party", () => {
    expect(hasSocialSignal(stats({ cardsCollected: 1 }))).toBe(true);
    expect(hasSocialSignal(stats({ roomCount: 1 }))).toBe(true);
  });
});

describe("longestStreakDays (high-water mark)", () => {
  it("earns streak badges from the best-ever run, not the live streak", () => {
    const weekStreak = ACHIEVEMENTS.find((a) => a.id === "weekStreak")!;
    const monthStreak = ACHIEVEMENTS.find((a) => a.id === "monthStreak")!;
    // live streak broken back to 1, but the high-water mark keeps the badges.
    const s = stats({ streakDays: 1, longestStreakDays: 30 });
    expect(weekStreak.achieved(s)).toBe(true);
    expect(monthStreak.achieved(s)).toBe(true);
  });

  it("keeps XP, level and streak badges unchanged when the live streak lapses to 0", () => {
    const active = stats({ streakDays: 30, longestStreakDays: 30, diaryCount: 5, pinCount: 3 });
    const lapsed = stats({ streakDays: 0, longestStreakDays: 30, diaryCount: 5, pinCount: 3 });
    expect(computeRank(lapsed).xp).toBe(computeRank(active).xp);
    expect(computeRank(lapsed).level).toBe(computeRank(active).level);
    const weekStreak = ACHIEVEMENTS.find((a) => a.id === "weekStreak")!;
    const monthStreak = ACHIEVEMENTS.find((a) => a.id === "monthStreak")!;
    expect(weekStreak.achieved(lapsed)).toBe(true);
    expect(monthStreak.achieved(lapsed)).toBe(true);
  });

  it("computeStats passes the high-water mark straight through", () => {
    const result = computeStats({
      pins: [],
      photos: [],
      diary: [],
      streakDays: 2,
      longestStreakDays: 12,
      roomCount: 0,
    });
    expect(result.streakDays).toBe(2);
    expect(result.longestStreakDays).toBe(12);
  });
});

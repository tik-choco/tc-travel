import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, computeRank, computeStats, xpForLevel } from "../gamification";
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
  });

  it("ignores blank companion names", () => {
    const result = computeStats({
      pins: [{ countryCode: "", companions: ["  ", "", "Zoe"] }],
      photos: [],
      diary: [],
      streakDays: 0,
      roomCount: 0,
    });
    expect(result.companionsMet).toEqual(["Zoe"]);
    expect(result.countriesVisited).toEqual([]);
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
});

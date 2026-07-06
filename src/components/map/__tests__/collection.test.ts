import { describe, expect, it } from "vitest";
import {
  ALL_PREFECTURE_CODES,
  BADGES,
  JP_TOTAL,
  LEGENDARY_CODES,
  REGIONS,
  REGION_ORDER,
  badgeLabel,
  completionStats,
  earnedBadges,
  rarityOf,
  regionStats,
} from "../collection";

describe("regions table", () => {
  it("covers all 47 prefecture codes exactly once", () => {
    expect(ALL_PREFECTURE_CODES).toHaveLength(JP_TOTAL);
    expect(new Set(ALL_PREFECTURE_CODES).size).toBe(JP_TOTAL);
    const expected = Array.from({ length: JP_TOTAL }, (_, i) => `JP-${String(i + 1).padStart(2, "0")}`);
    expect([...ALL_PREFECTURE_CODES].sort()).toEqual(expected);
  });

  it("keeps well-known prefectures in their traditional regions", () => {
    expect(REGIONS.hokkaido).toContain("JP-01");
    expect(REGIONS.kanto).toContain("JP-13"); // Tokyo
    expect(REGIONS.kinki).toContain("JP-27"); // Osaka
    expect(REGIONS.kyushu).toContain("JP-40"); // Fukuoka
    expect(REGIONS.okinawa).toEqual(["JP-47"]);
  });
});

describe("completionStats", () => {
  it("reports zero for an empty journey", () => {
    expect(completionStats(new Set())).toEqual({ count: 0, total: 47, pct: 0, exactPct: 0 });
  });

  it("counts a single visit and keeps the exact percentage unrounded", () => {
    const s = completionStats(new Set(["JP-13"]));
    expect(s.count).toBe(1);
    expect(s.pct).toBe(2); // 1/47 = 2.127... rounds to 2
    expect(s.exactPct).toBeGreaterThan(2);
    expect(s.exactPct).toBeLessThan(3);
  });

  it("ignores codes that are not prefectures", () => {
    const s = completionStats(new Set(["fr", "jp", "JP-99", "JP-13"]));
    expect(s.count).toBe(1);
  });

  it("hits exactly 100% at full completion", () => {
    const s = completionStats(new Set(ALL_PREFECTURE_CODES));
    expect(s.count).toBe(47);
    expect(s.pct).toBe(100);
    expect(s.exactPct).toBe(100);
  });
});

describe("regionStats", () => {
  it("returns every region in display order with correct totals", () => {
    const stats = regionStats(new Set());
    expect(stats.map((r) => r.id)).toEqual([...REGION_ORDER]);
    expect(stats.reduce((sum, r) => sum + r.total, 0)).toBe(JP_TOTAL);
  });

  it("counts per-region visits", () => {
    const stats = regionStats(new Set([...REGIONS.shikoku, "JP-13"]));
    const shikoku = stats.find((r) => r.id === "shikoku");
    const kanto = stats.find((r) => r.id === "kanto");
    expect(shikoku).toEqual({ id: "shikoku", count: 4, total: 4 });
    expect(kanto).toEqual({ id: "kanto", count: 1, total: 7 });
  });
});

describe("rarityOf", () => {
  it("classifies representative prefectures", () => {
    expect(rarityOf("JP-13")).toBe("common"); // Tokyo
    expect(rarityOf("JP-20")).toBe("uncommon"); // Nagano
    expect(rarityOf("JP-41")).toBe("rare"); // Saga
    expect(rarityOf("JP-32")).toBe("legendary"); // Shimane
  });

  it("defaults unknown codes to uncommon rather than throwing", () => {
    expect(rarityOf("JP-99")).toBe("uncommon");
  });

  it("assigns a tier to all 47 and keeps legendary a short, flexible list", () => {
    const byTier = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (const code of ALL_PREFECTURE_CODES) byTier[rarityOf(code)]++;
    expect(byTier.common + byTier.uncommon + byTier.rare + byTier.legendary).toBe(JP_TOTAL);
    expect(byTier.legendary).toBeGreaterThan(0);
    expect(byTier.legendary).toBeLessThanOrEqual(6);
    expect(LEGENDARY_CODES).toHaveLength(byTier.legendary);
  });
});

describe("earnedBadges", () => {
  it("awards nothing for an empty journey", () => {
    expect(earnedBadges(new Set())).toEqual([]);
  });

  it("awards first-step for a single common prefecture", () => {
    expect(earnedBadges(new Set(["JP-13"]))).toEqual(["first-step"]);
  });

  it("awards hidden-gem for any legendary prefecture", () => {
    expect(earnedBadges(new Set(["JP-32"]))).toEqual(["hidden-gem", "first-step"]);
  });

  it("awards ten at 10 visits but not half", () => {
    const ten = new Set(ALL_PREFECTURE_CODES.slice(7, 17)); // 10 codes, no full region
    const badges = earnedBadges(ten);
    expect(badges).toContain("ten");
    expect(badges).not.toContain("half");
  });

  it("awards a region badge when every prefecture of that region is visited", () => {
    const badges = earnedBadges(new Set(REGIONS.shikoku));
    expect(badges).toContain("region-shikoku");
    expect(badges).not.toContain("region-kyushu");
  });

  it("awards everything at 100%, most prestigious first", () => {
    const badges = earnedBadges(new Set(ALL_PREFECTURE_CODES));
    expect(badges[0]).toBe("complete");
    expect(badges).toHaveLength(BADGES.length); // every badge fires at full completion
    for (const region of REGION_ORDER) expect(badges).toContain(`region-${region}`);
  });
});

describe("badgeLabel", () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}[${Object.values(params).join(",")}]` : key;

  it("resolves plain badges to their i18n key", () => {
    expect(badgeLabel("first-step", t)).toBe("map.jp.badge.first-step");
  });

  it("resolves region badges through the region-name entry", () => {
    expect(badgeLabel("region-kyushu", t)).toBe("map.jp.badge.region[map.jp.region.kyushu]");
  });
});

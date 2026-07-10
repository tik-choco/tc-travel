// The vitest runner is node-only (no DOM), so this exercises the two contracts
// that can break silently: (1) the avatar.* dictionary covering all 8 languages
// (a missing locale falls back to English at runtime with no error — a
// regression for a worldwide audience), and (2) the tab-set ordering the shell
// ships, which is easy to reshuffle by accident.
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../../lib/types";
import { avatarTranslations } from "../avatar.i18n";
import { SOLO_TABS, ROOM_TABS } from "../../shell/TabBar";

const entries = Object.entries(avatarTranslations);

describe("avatar.i18n", () => {
  it("namespaces every key under avatar.", () => {
    for (const [key] of entries) expect(key).toMatch(/^avatar\./);
  });

  it("covers all 8 languages for every key", () => {
    for (const [key, entry] of entries) {
      for (const lang of LANGUAGES) {
        const value = entry[lang];
        expect(value, `${key} is missing ${lang}`).toBeDefined();
        expect(value, `${key} resolves empty for ${lang}`).toBeTruthy();
      }
    }
  });
});

describe("shell tab sets", () => {
  it("ships the avatar-priority solo order", () => {
    expect(SOLO_TABS).toEqual(["home", "avatar", "map", "album", "diary", "post", "guild"]);
  });

  it("ships the map-landing room order with avatar second", () => {
    expect(ROOM_TABS).toEqual(["map", "avatar", "album", "diary", "post", "guild"]);
  });

  it("promotes avatar into both sets and retires the old camera id", () => {
    expect(SOLO_TABS).toContain("avatar");
    expect(ROOM_TABS).toContain("avatar");
    expect(SOLO_TABS).not.toContain("camera");
    expect(ROOM_TABS).not.toContain("camera");
  });

  it("keeps home solo-only and post available in both", () => {
    expect(SOLO_TABS).toContain("home");
    expect(ROOM_TABS).not.toContain("home");
    expect(ROOM_TABS).toContain("post");
    expect(SOLO_TABS).toContain("post");
  });
});

// The vitest runner is node-only (no DOM), so this exercises the share sheet's
// contract that CAN break silently: the solo.* dictionary. A missing language
// falls back to English at runtime without any error — for a worldwide audience
// that's a regression, so completeness is asserted here instead.
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../../lib/types";
import { soloTranslations } from "../solo.i18n";

const entries = Object.entries(soloTranslations);

describe("solo.i18n", () => {
  it("namespaces every key under solo.", () => {
    for (const [key] of entries) expect(key).toMatch(/^solo\./);
  });

  it("covers all 8 languages for every key", () => {
    for (const [key, entry] of entries) {
      for (const lang of LANGUAGES) {
        const value = entry[lang];
        expect(value, `${key} is missing ${lang}`).toBeDefined();
        const text = typeof value === "function" ? value({ n: 3, total: 3 }) : value;
        expect(text, `${key} resolves empty for ${lang}`).toBeTruthy();
      }
    }
  });

  it("interpolates the count into every count-bearing entry, in every language", () => {
    const countKeys = ["solo.sharePlaces", "solo.sharePages", "solo.sharePhotos", "solo.shareDoneDetail"] as const;
    for (const key of countKeys) {
      const entry = soloTranslations[key];
      for (const lang of LANGUAGES) {
        const fn = entry[lang];
        if (typeof fn !== "function") throw new Error(`${key}.${lang} should be a function entry`);
        expect(fn({ n: 7, total: 7 }), `${key} drops the count in ${lang}`).toContain("7");
      }
    }
  });

  it("pluralizes English counts on n === 1", () => {
    const places = soloTranslations["solo.sharePlaces"].en;
    const photos = soloTranslations["solo.sharePhotos"].en;
    if (typeof places !== "function" || typeof photos !== "function") throw new Error("expected function entries");
    expect(places({ n: 1 })).toBe("1 place");
    expect(places({ n: 4 })).toBe("4 places");
    expect(photos({ n: 1 })).toBe("1 photo");
    expect(photos({ n: 2 })).toBe("2 photos");
  });
});

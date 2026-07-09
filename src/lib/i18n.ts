// i18n runtime with side-effect registration so each feature owns its own
// dictionary file (avoids merge conflicts between modules). Pattern adapted
// from tc-note/src/lib/i18n.ts, extended from 2 to 8 languages.
//
// Usage in a feature:
//   // map.i18n.ts
//   import { registerTranslations } from "../../lib/i18n";
//   registerTranslations({
//     "map.title": { en: "World Atlas", ja: "世界地図", zh: "世界地图", ko: "세계 지도",
//                     es: "Atlas Mundial", fr: "Atlas du Monde", de: "Weltatlas", pt: "Atlas Mundial" },
//   });
//   // WorldMap.tsx
//   import "./map.i18n";
//   const t = useT();
//   <h1>{t("map.title")}</h1>

import { useEffect, useState } from "preact/hooks";
import { LANGUAGES, type Language } from "./types";

export type Params = Record<string, string | number>;
type Entry = string | ((params: Params) => string);
/** en is mandatory (fallback); other languages should be provided but degrade gracefully. */
export type TranslationEntry = { en: Entry } & Partial<Record<Exclude<Language, "en">, Entry>>;

const dict = new Map<string, TranslationEntry>();

export function registerTranslations(entries: Record<string, TranslationEntry>): void {
  for (const [key, entry] of Object.entries(entries)) dict.set(key, entry);
}

const STORAGE_KEY = "tc-travel:language";

export function detectLanguage(): Language {
  // try/catch rather than feature-detection: lets non-DOM importers (vitest's
  // node runner, where a stub localStorage global may exist but not work) load
  // this module, and covers browsers where storage access throws.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  // navigator.languages is the user's full preference list — a supported
  // secondary language beats falling back to English on the primary alone.
  const candidates =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  for (const candidate of candidates) {
    const nav = candidate.toLowerCase();
    for (const lang of LANGUAGES) {
      if (nav === lang || nav.startsWith(`${lang}-`)) return lang;
    }
    if (nav.startsWith("zh")) return "zh";
  }
  return "en";
}

let currentLanguage: Language = detectLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  // All 8 supported languages are LTR today; set it explicitly so a future
  // RTL language only has to change this one spot.
  document.documentElement.dir = "ltr";
  for (const fn of listeners) fn();
}

export function translate(key: string, params?: Params): string {
  const entry = dict.get(key);
  if (!entry) return key;
  const value = entry[currentLanguage] ?? entry.en;
  return typeof value === "function" ? value(params ?? {}) : value;
}

/** Hook: returns t() bound to the current language; re-renders on language change. */
export function useT(): (key: string, params?: Params) => string {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return translate;
}

/** Native-script display names for the language picker. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  ja: "日本語",
  zh: "中文",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
};

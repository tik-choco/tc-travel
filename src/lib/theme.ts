// Theme preference plumbing. styles/theme.css keys every token off a
// `data-theme` attribute on <html>: absent = "auto" (a prefers-color-scheme
// block follows the OS), "light"/"dark" force a scheme. This module resolves
// the profile's ThemePref to that attribute and keeps the PWA's
// <meta name="theme-color"> in sync with the resolved scheme.
import { useState } from "preact/hooks";
import type { ThemePref } from "./types";
import { getProfile, updateProfile } from "./personal";

// Match styles/theme.css --surface for each scheme (browser chrome color).
const META_THEME_LIGHT = "#fbf5ec";
const META_THEME_DARK = "#131318";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "auto") delete root.dataset.theme;
  else root.dataset.theme = pref;

  const resolvedDark =
    pref === "dark" || (pref === "auto" && window.matchMedia(DARK_QUERY).matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolvedDark ? META_THEME_DARK : META_THEME_LIGHT);
}

// In "auto" mode the CSS tracks the OS by itself, but the meta tag can't —
// re-apply on OS scheme changes. (Guarded: jsdom has no matchMedia.)
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if ((getProfile().theme ?? "light") === "auto") applyTheme("auto");
  });
}

export function useThemeSetting(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => getProfile().theme ?? "light");
  const set = (next: ThemePref) => {
    updateProfile({ theme: next });
    applyTheme(next);
    setPref(next);
  };
  return [pref, set];
}

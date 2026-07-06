// Shared mood metadata for diary entries: the fixed emoji-per-mood map (content,
// not chrome — moods are user-authored flavor) plus a small MD3 `.chip` renderer
// used by both the entry list and the reader. Labels come from `mood.*` keys in
// src/lib/common.i18n.ts (shared across features, do not duplicate here).
import { useT } from "../../lib/i18n";

export const MOODS = ["triumphant", "merry", "weary", "wistful", "inspired"] as const;

export const MOOD_EMOJI: Record<string, string> = {
  triumphant: "🏆",
  merry: "🎉",
  weary: "😴",
  wistful: "🌙",
  inspired: "✨",
};

export function MoodChip({ mood }: { mood: string }) {
  const t = useT();
  return (
    <span class="chip mood-chip">
      <span aria-hidden="true">{MOOD_EMOJI[mood] ?? "📖"}</span>
      <span class="chip-text">{t(`mood.${mood}`)}</span>
    </span>
  );
}

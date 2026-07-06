import { useMemo, useState } from "preact/hooks";
import { Feather, ScrollText } from "lucide-preact";
import { useSession, useMembers, useDiary, removeDiaryEntry } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { getLanguage, useT } from "../../lib/i18n";
import { DiaryEditor } from "./DiaryEditor";
import { DiaryReader } from "./DiaryReader";
import type { DiaryEntry } from "../../lib/types";
import "./diary.i18n";
import "./diary.css";

const MOOD_EMOJI: Record<string, string> = {
  triumphant: "🏆",
  merry: "🎉",
  weary: "😴",
  wistful: "🌙",
  inspired: "✨",
};

const EXCERPT_LEN = 100;

function excerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= EXCERPT_LEN) return trimmed;
  return `${trimmed.slice(0, EXCERPT_LEN).trimEnd()}…`;
}

export function DiaryScreen() {
  const t = useT();
  const session = useSession();
  const diary = useDiary();
  const members = useMembers();
  const [profile] = useProfile();
  const [reading, setReading] = useState<DiaryEntry | null>(null);
  const [editing, setEditing] = useState<DiaryEntry | null | "new">(null);

  const sorted = useMemo(() => [...diary].sort((a, b) => b.at - a.at), [diary]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  if (!session) {
    return (
      <div class="screen diary-screen">
        <div class="panel diary-empty">
          <ScrollText size={40} />
          <p>{t("diary.needSession")}</p>
        </div>
      </div>
    );
  }

  return (
    <div class="screen diary-screen">
      <header class="diary-header">
        <h1 class="title-ornate">{t("diary.title")}</h1>
        <button type="button" class="btn btn-primary" onClick={() => setEditing("new")}>
          <Feather size={18} /> {t("diary.newEntry")}
        </button>
      </header>

      {sorted.length === 0 ? (
        <div class="panel diary-empty">
          <ScrollText size={40} />
          <p>{t("diary.emptyState")}</p>
        </div>
      ) : (
        <ul class="diary-list">
          {sorted.map((entry) => {
            const author = memberById.get(entry.by);
            const authorLabel = author ? `${author.avatarEmoji} ${author.name}` : t("diary.fellowTraveler");
            const dateLabel = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium" }).format(
              new Date(entry.at),
            );
            return (
              <li key={entry.id}>
                <button type="button" class="panel diary-card" onClick={() => setReading(entry)}>
                  <span class="diary-card-mood" aria-hidden="true">
                    {MOOD_EMOJI[entry.mood] ?? "📖"}
                  </span>
                  <span class="diary-card-body">
                    <span class="diary-card-title">{entry.title}</span>
                    <span class="diary-card-excerpt">{excerpt(entry.text)}</span>
                    <span class="diary-card-meta">
                      {authorLabel} · {dateLabel}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing !== null && (
        <DiaryEditor entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}

      {reading && (
        <DiaryReader
          entry={reading}
          author={memberById.get(reading.by) ?? null}
          isOwn={reading.by === profile.id}
          onClose={() => setReading(null)}
          onEdit={() => {
            setEditing(reading);
            setReading(null);
          }}
          onDelete={() => {
            removeDiaryEntry(reading.id);
            setReading(null);
          }}
        />
      )}
    </div>
  );
}

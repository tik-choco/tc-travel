import { useMemo, useState } from "preact/hooks";
import { PenLine, ScrollText } from "lucide-preact";
import { useMembers } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useDiaryEntries, removeDiaryAuto, type SourcedDiaryEntry } from "../../lib/memories";
import { getLanguage, useT } from "../../lib/i18n";
import type { Member } from "../../lib/types";
import { Avatar } from "../common/Avatar";
import { DiaryEditor } from "./DiaryEditor";
import { DiaryReader } from "./DiaryReader";
import { MoodChip } from "./moodMeta";
import "./diary.i18n";
import "./diary.css";

const EXCERPT_LEN = 100;

function excerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= EXCERPT_LEN) return trimmed;
  return `${trimmed.slice(0, EXCERPT_LEN).trimEnd()}…`;
}

export function DiaryScreen() {
  const t = useT();
  // Room + solo entries, each tagged with its source so edit/delete route home
  // correctly (see removeDiaryAuto / DiaryEditor). No session gate — the journal
  // is always writable now.
  const diary = useDiaryEntries();
  const members = useMembers();
  const [profile] = useProfile();
  const [reading, setReading] = useState<SourcedDiaryEntry | null>(null);
  const [editing, setEditing] = useState<SourcedDiaryEntry | null | "new">(null);

  const sorted = useMemo(() => [...diary].sort((a, b) => b.at - a.at), [diary]);
  // Fold the local profile in as a synthetic member so your own solo entries
  // show as yours; a room member record, when present, is never overridden.
  const memberById = useMemo(() => {
    const map = new Map<string, Member>(members.map((m) => [m.id, m]));
    if (!map.has(profile.id)) {
      map.set(profile.id, {
        id: profile.id,
        name: profile.name,
        color: profile.color,
        avatarEmoji: profile.avatarEmoji,
        joinedAt: 0,
      });
    }
    return map;
  }, [members, profile.id, profile.name, profile.color, profile.avatarEmoji]);

  return (
    <div class="screen diary-screen">
      <h1 class="title-ornate">{t("diary.title")}</h1>

      {sorted.length === 0 ? (
        <div class="empty-state">
          <div class="empty-state-icon">
            <ScrollText size={28} />
          </div>
          <p class="empty-state-title">{t("diary.emptyTitle")}</p>
          <p class="empty-state-hint">{t("diary.emptyState")}</p>
          <button type="button" class="btn btn-primary" onClick={() => setEditing("new")}>
            <PenLine size={18} /> {t("diary.newEntry")}
          </button>
        </div>
      ) : (
        <ul class="diary-list">
          {sorted.map((entry) => {
            const author = memberById.get(entry.by);
            const dateLabel = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium" }).format(
              new Date(entry.at),
            );
            return (
              <li key={entry.id}>
                <button type="button" class="list-item diary-card" onClick={() => setReading(entry)}>
                  {author ? (
                    <Avatar member={author} size="sm" ringColor={author.color} />
                  ) : (
                    <span class="avatar avatar-sm" aria-hidden="true" />
                  )}
                  <span class="list-item-body">
                    <span class="diary-card-title-row">
                      <span class="list-item-title">{entry.title}</span>
                      <MoodChip mood={entry.mood} />
                    </span>
                    <span class="list-item-sub">{excerpt(entry.text)}</span>
                  </span>
                  <span class="list-item-trailing diary-card-date">{dateLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" class="fab" onClick={() => setEditing("new")}>
        <PenLine size={22} />
        <span class="fab-label">{t("diary.newEntry")}</span>
      </button>

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
            removeDiaryAuto(reading);
            setReading(null);
          }}
        />
      )}
    </div>
  );
}

import { MapPin, Pencil, Trash2, X } from "lucide-preact";
import { countryName } from "../../lib/geo";
import { getLanguage, useT } from "../../lib/i18n";
import type { DiaryEntry, Member } from "../../lib/types";

const MOOD_EMOJI: Record<string, string> = {
  triumphant: "🏆",
  merry: "🎉",
  weary: "😴",
  wistful: "🌙",
  inspired: "✨",
};

interface DiaryReaderProps {
  entry: DiaryEntry;
  author: Member | null;
  isOwn: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Full journal page: parchment panel with a CSS drop-cap on the first letter. */
export function DiaryReader({ entry, author, isOwn, onClose, onEdit, onDelete }: DiaryReaderProps) {
  const t = useT();
  const authorLabel = author ? `${author.avatarEmoji} ${author.name}` : t("diary.fellowTraveler");
  const dateLabel = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "long" }).format(new Date(entry.at));
  const locationLabel = entry.geo?.countryCode ? countryName(entry.geo.countryCode, getLanguage()) : null;

  const handleDelete = () => {
    if (window.confirm(t("diary.confirmDelete"))) onDelete();
  };

  return (
    <div class="diary-modal-backdrop" role="dialog" aria-modal="true">
      <div class="diary-modal panel">
        <div class="diary-reader-header">
          <h2 class="title-ornate">
            <span aria-hidden="true">{MOOD_EMOJI[entry.mood] ?? "📖"}</span> {entry.title}
          </h2>
          <button type="button" class="btn" onClick={onClose} aria-label={t("diary.close")}>
            <X size={16} />
          </button>
        </div>

        <div class="diary-reader-meta">
          <span>{authorLabel}</span>
          <span>{dateLabel}</span>
          {locationLabel && (
            <span>
              <MapPin size={12} style={{ verticalAlign: "-2px" }} /> {locationLabel}
            </span>
          )}
        </div>

        <p class="diary-reader-text">{entry.text}</p>

        {isOwn && (
          <div class="diary-reader-actions">
            <button type="button" class="btn" onClick={onEdit}>
              <Pencil size={16} /> {t("diary.edit")}
            </button>
            <button type="button" class="btn" onClick={handleDelete}>
              <Trash2 size={16} /> {t("diary.delete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

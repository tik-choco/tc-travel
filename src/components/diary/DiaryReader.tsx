import { MapPin, Pencil, Trash2, X } from "lucide-preact";
import { Avatar } from "../common/Avatar";
import { countryName } from "../../lib/geo";
import { getLanguage, useT } from "../../lib/i18n";
import { MoodChip } from "./moodMeta";
import type { DiaryEntry, Member } from "../../lib/types";

interface DiaryReaderProps {
  entry: DiaryEntry;
  author: Member | null;
  isOwn: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Full journal entry as a bottom sheet: mood chip, clean typography, icon actions. */
export function DiaryReader({ entry, author, isOwn, onClose, onEdit, onDelete }: DiaryReaderProps) {
  const t = useT();
  const dateLabel = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "long" }).format(new Date(entry.at));
  const locationLabel = entry.geo?.countryCode ? countryName(entry.geo.countryCode, getLanguage()) : null;

  const handleDelete = () => {
    if (window.confirm(t("diary.confirmDelete"))) onDelete();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-card diary-sheet">
        <div class="sheet-handle" />

        <div class="diary-reader-header">
          <MoodChip mood={entry.mood} />
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("diary.close")}>
            <X size={18} />
          </button>
        </div>

        <h2 class="diary-reader-title">{entry.title}</h2>

        <div class="diary-reader-meta">
          <span class="diary-reader-author">
            {author ? (
              <>
                <Avatar member={author} size="sm" ringColor={author.color} />
                {author.name}
              </>
            ) : (
              t("diary.fellowTraveler")
            )}
          </span>
          <span>{dateLabel}</span>
          {locationLabel && (
            <span class="diary-reader-location">
              <MapPin size={14} /> {locationLabel}
            </span>
          )}
        </div>

        <p class="diary-reader-text">{entry.text}</p>

        {isOwn && (
          <div class="diary-reader-actions">
            <button type="button" class="btn btn-icon" onClick={onEdit} aria-label={t("diary.edit")}>
              <Pencil size={18} />
            </button>
            <button type="button" class="btn btn-icon btn-danger" onClick={handleDelete} aria-label={t("diary.delete")}>
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

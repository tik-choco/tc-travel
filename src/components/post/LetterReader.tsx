import { useEffect } from "preact/hooks";
import { Trash2, X } from "lucide-preact";
import { markLetterRead } from "../../lib/store";
import { getLanguage, useT } from "../../lib/i18n";
import { Avatar } from "../common/Avatar";
import type { Letter, Member } from "../../lib/types";

interface LetterReaderProps {
  letter: Letter;
  from: Member | null;
  to: Member | null;
  /** true when the viewer wrote this letter — enables delete. */
  isMine: boolean;
  /** true when the letter is addressed to the viewer — opening marks it read. */
  isForMe: boolean;
  onClose: () => void;
  onDelete: () => void;
}

/** Full letter as a bottom sheet: the seal "breaks" and the page unfolds
 *  (reduced-motion aware, see post.css). */
export function LetterReader({ letter, from, to, isMine, isForMe, onClose, onDelete }: LetterReaderProps) {
  const t = useT();
  const dateLabel = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "long" }).format(new Date(letter.at));

  // Opening the envelope is what marks it read — mirrored into the shared doc
  // so the unread glow clears everywhere once the recipient has looked.
  useEffect(() => {
    if (isForMe && !letter.read) markLetterRead(letter.id);
  }, [letter.id, letter.read, isForMe]);

  const handleDelete = () => {
    if (window.confirm(t("post.confirmDelete"))) onDelete();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div class="modal-card post-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />

        <div class="post-sheet-header">
          <span class="post-reader-seal" aria-hidden="true">
            {letter.seal}
          </span>
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("post.close")}>
            <X size={18} />
          </button>
        </div>

        <div class="post-reader-unfold">
          <h2 class="post-reader-subject">{letter.subject.trim() || t("post.noSubject")}</h2>

          <div class="post-reader-meta">
            <span class="post-reader-person">
              <Avatar member={from} size="sm" ringColor={from?.color} />
              {t("post.fromLine", { name: from?.name ?? t("post.fellowTraveler") })}
            </span>
            <span class="post-reader-person">
              <Avatar member={to} size="sm" ringColor={to?.color} />
              {t("post.toLine", { name: to?.name ?? t("post.fellowTraveler") })}
            </span>
            <span>{dateLabel}</span>
          </div>

          <p class="post-reader-text">{letter.body}</p>
        </div>

        {isMine && (
          <div class="post-sheet-actions">
            <button type="button" class="btn btn-icon btn-danger" onClick={handleDelete} aria-label={t("post.delete")}>
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import "./post.i18n";
import { Trash2, X } from "lucide-preact";
import { getLanguage, useT } from "../../lib/i18n";
import { useUnlocks } from "../../lib/unlocks";
import type { Card } from "../../lib/types";

interface Props {
  card: Card;
  onClose: () => void;
  onRemove: () => void;
}

/** Full keepsake view of a collected card — the sender's card at full size,
 *  stamped with the day you met (the first scan; rescans don't move it). */
export function CardView({ card, onClose, onRemove }: Props) {
  const t = useT();
  // The keepsake's trim deepens as you collect more cards (cardMotifs unlock):
  // a first-card border, then gold trim at ten real-world meetings.
  const { cardTier } = useUnlocks();
  const metOn = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "long" }).format(
    new Date(card.receivedAt ?? card.at),
  );

  const handleRemove = () => {
    if (window.confirm(t("post.confirmRemove"))) onRemove();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={card.name} onClick={onClose}>
      <div class="modal-card post-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />

        <div class="post-sheet-header">
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("post.close")}>
            <X size={18} />
          </button>
        </div>

        <div class={`card-face card-face-full card-motif-${cardTier}`} style={`--card-color: ${card.color}`}>
          <span class="avatar avatar-xl" aria-hidden="true">
            {card.avatarEmoji}
          </span>
          <span class="card-face-name">{card.name}</span>
          {card.message !== "" && <p class="card-face-message">{card.message}</p>}
          <span class="card-face-met">{t("post.metOn", { date: metOn })}</span>
        </div>

        <div class="post-sheet-actions">
          <button type="button" class="btn btn-icon btn-danger" onClick={handleRemove} aria-label={t("post.remove")}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

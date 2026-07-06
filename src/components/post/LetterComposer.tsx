import { useMemo, useState } from "preact/hooks";
import { Send, UserRound, X } from "lucide-preact";
import { sendLetter, useMembers } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useT } from "../../lib/i18n";
import { Avatar } from "../common/Avatar";

/** Warm stationery seals the sender can stamp on a letter. */
const SEALS = ["✉️", "💌", "📜", "🕊️", "🌸", "⭐️", "🎁", "💛"];

/** How long the send delight (seal stamp + fly-away) plays before the sheet
 *  closes. Matches post.css's post-stamp-fly duration. */
const SEND_FX_MS = 750;

interface LetterComposerProps {
  onClose: () => void;
}

export function LetterComposer({ onClose }: LetterComposerProps) {
  const t = useT();
  const members = useMembers();
  const [profile] = useProfile();
  // "Friends" = the party's other members; you can't post a letter to yourself.
  const recipients = useMemo(() => members.filter((m) => m.id !== profile.id), [members, profile.id]);

  const [to, setTo] = useState(recipients.length === 1 ? recipients[0].id : "");
  const [seal, setSeal] = useState(SEALS[0]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (sending) return;
    if (!to || !body.trim()) {
      setShowValidation(true);
      return;
    }
    sendLetter({ to, subject: subject.trim(), body: body.trim(), seal });
    // Give the wax-seal stamp + fly-away a beat to play before closing;
    // reduced-motion users get an instant close instead of a silent delay.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setSending(true);
    window.setTimeout(onClose, SEND_FX_MS);
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" onClick={sending ? undefined : onClose}>
      <div class="modal-card post-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />

        <div class="post-sheet-header">
          <h2 class="post-sheet-title">{t("post.composerTitle")}</h2>
          <button
            type="button"
            class="btn btn-icon"
            onClick={onClose}
            disabled={sending}
            aria-label={t("post.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div class="field">
          <span class="settings-label">{t("post.toLabel")}</span>
          {recipients.length === 0 ? (
            <p class="post-no-recipients">
              <UserRound size={16} /> {t("post.noRecipients")}
            </p>
          ) : (
            <div class="post-recipient-picker">
              {recipients.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  class={`chip post-recipient-chip${to === m.id ? " is-selected" : ""}`}
                  aria-pressed={to === m.id}
                  onClick={() => setTo(m.id)}
                >
                  <Avatar member={m} size="sm" ringColor={m.color} />
                  <span class="chip-text">{m.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div class="field">
          <span class="settings-label">{t("post.sealLabel")}</span>
          <div class="post-seal-picker">
            {SEALS.map((s) => (
              <button
                type="button"
                key={s}
                class={`chip post-seal-chip${seal === s ? " is-selected" : ""}`}
                aria-pressed={seal === s}
                aria-label={s}
                onClick={() => setSeal(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          class="input"
          maxLength={80}
          placeholder={t("post.subjectPlaceholder")}
          aria-label={t("post.subjectPlaceholder")}
          value={subject}
          onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
        />

        <textarea
          class="input post-body-input"
          placeholder={t("post.bodyPlaceholder")}
          aria-label={t("post.bodyPlaceholder")}
          value={body}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
        />

        {showValidation && <p class="post-validation">{t("post.validationRequired")}</p>}

        <div class="post-sheet-actions">
          <button type="button" class="btn btn-outlined" onClick={onClose} disabled={sending}>
            {t("post.cancel")}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={handleSend}
            disabled={sending || recipients.length === 0}
          >
            <Send size={16} />
            {sending ? t("post.sending") : t("post.send")}
          </button>
        </div>

        {sending && (
          <div class="post-send-fx" aria-hidden="true">
            <span class="post-send-fx-letter">{seal}</span>
          </div>
        )}
      </div>
    </div>
  );
}

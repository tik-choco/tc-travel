import { useMemo, useState } from "preact/hooks";
import { Feather, Mailbox } from "lucide-preact";
import { useSession, useMembers, useLetters, removeLetter } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { partitionLetters } from "../../lib/letters";
import { getLanguage, useT } from "../../lib/i18n";
import { Avatar } from "../common/Avatar";
import { LetterComposer } from "./LetterComposer";
import { LetterReader } from "./LetterReader";
import type { Letter } from "../../lib/types";
import "./post.i18n";
import "./post.css";

export function PostScreen() {
  const t = useT();
  const session = useSession();
  const letters = useLetters();
  const members = useMembers();
  const [profile] = useProfile();
  const [composing, setComposing] = useState(false);
  const [reading, setReading] = useState<Letter | null>(null);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  // useLetters is already sorted by `at` DESC and partitionLetters preserves
  // order, so both piles come out newest-first.
  const { inbox, sent, unreadCount } = useMemo(
    () => partitionLetters(letters, profile.id),
    [letters, profile.id],
  );

  if (!session) {
    return (
      <div class="screen post-screen">
        <div class="empty-state">
          <div class="empty-state-icon">
            <Mailbox size={28} />
          </div>
          <p class="empty-state-title">{t("post.needSessionTitle")}</p>
          <p class="empty-state-hint">{t("post.needSession")}</p>
        </div>
      </div>
    );
  }

  const dateFmt = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium" });

  // One row for either pile; `counterpartId` is the other person on the
  // envelope (sender for inbox letters, recipient for sent ones).
  const renderLetter = (letter: Letter, counterpartId: string, unread: boolean) => {
    const counterpart = memberById.get(counterpartId);
    return (
      <li key={letter.id}>
        <button
          type="button"
          class={`list-item post-letter${unread ? " is-unread" : ""}`}
          onClick={() => setReading(letter)}
        >
          {counterpart ? (
            <Avatar member={counterpart} size="sm" ringColor={counterpart.color} />
          ) : (
            <span class="avatar avatar-sm" aria-hidden="true" />
          )}
          <span class="list-item-body">
            <span class="post-letter-title-row">
              {unread && <span class="post-unread-dot" role="img" aria-label={t("post.unread")} />}
              <span class="list-item-title">{letter.subject.trim() || t("post.noSubject")}</span>
            </span>
            <span class="list-item-sub">{counterpart?.name ?? t("post.fellowTraveler")}</span>
          </span>
          <span class="list-item-trailing post-letter-trailing">
            <span class="post-letter-seal" aria-hidden="true">
              {letter.seal}
            </span>
            <span class="post-letter-date">{dateFmt.format(new Date(letter.at))}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div class="screen post-screen">
      <h1 class="title-ornate">{t("post.title")}</h1>

      {letters.length === 0 ? (
        <div class="empty-state">
          <div class="empty-state-icon">
            <Mailbox size={28} />
          </div>
          <p class="empty-state-title">{t("post.emptyTitle")}</p>
          <p class="empty-state-hint">{t("post.emptyState")}</p>
          <button type="button" class="btn btn-primary" onClick={() => setComposing(true)}>
            <Feather size={18} /> {t("post.compose")}
          </button>
        </div>
      ) : (
        <>
          <section class="post-section">
            <h2 class="section-title post-section-title">
              {t("post.inbox")}
              {unreadCount > 0 && <span class="post-unread-badge">{unreadCount}</span>}
            </h2>
            {inbox.length === 0 ? (
              <p class="post-section-empty">{t("post.inboxEmpty")}</p>
            ) : (
              <ul class="post-list">{inbox.map((letter) => renderLetter(letter, letter.from, !letter.read))}</ul>
            )}
          </section>

          <section class="post-section">
            <h2 class="section-title post-section-title">{t("post.sent")}</h2>
            {sent.length === 0 ? (
              <p class="post-section-empty">{t("post.sentEmpty")}</p>
            ) : (
              <ul class="post-list">{sent.map((letter) => renderLetter(letter, letter.to, false))}</ul>
            )}
          </section>
        </>
      )}

      <button type="button" class="fab" onClick={() => setComposing(true)}>
        <Feather size={22} />
        <span class="fab-label">{t("post.compose")}</span>
      </button>

      {composing && <LetterComposer onClose={() => setComposing(false)} />}

      {reading && (
        <LetterReader
          letter={reading}
          from={memberById.get(reading.from) ?? null}
          to={memberById.get(reading.to) ?? null}
          isMine={reading.from === profile.id}
          isForMe={reading.to === profile.id}
          onClose={() => setReading(null)}
          onDelete={() => {
            removeLetter(reading.id);
            setReading(null);
          }}
        />
      )}
    </div>
  );
}

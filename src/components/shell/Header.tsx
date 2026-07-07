import "./shell.i18n";
import { useState } from "preact/hooks";
import { Share, LogOut, X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useSession, useMembers, leaveRoom } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { Avatar } from "../common/Avatar";
import { QrModal } from "../room/QrModal";

const STACK_LIMIT = 4;

export function Header() {
  const t = useT();
  const session = useSession();
  const members = useMembers();
  const [profile] = useProfile();
  const [showQr, setShowQr] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Solo variant: no party name, member stack, share or leave — just a calm
  // wordmark so the shell still has a top bar (keeps the tab bar anchored and
  // avoids a layout jump when you join or leave a room). The room variant below
  // is untouched.
  if (!session) {
    return (
      <header class="app-header app-header--solo">
        <span class="app-header-emoji" aria-hidden="true">
          {"\u{1F9ED}"}
        </span>
        <div class="app-header-info">
          <span class="app-header-name">{t("header.solo.title")}</span>
        </div>
      </header>
    );
  }

  const shownMembers = members.slice(0, STACK_LIMIT);
  const overflow = members.length - shownMembers.length;

  return (
    <header class="app-header">
      <span class="app-header-emoji" aria-hidden="true">
        {session.meta.emoji}
      </span>
      <div class="app-header-info">
        <span class="app-header-name">{session.meta.name}</span>
        <span class="app-header-status">
          <span class={`status-dot${session.connected ? " is-connected" : ""}`} aria-hidden="true" />
          {session.connected ? t("header.connected") : t("header.disconnected")}
        </span>
      </div>

      <button
        type="button"
        class="app-header-stack"
        aria-label={t("header.membersLabel")}
        onClick={() => setShowMembers(true)}
      >
        {shownMembers.map((m) => (
          <Avatar key={m.id} member={m} size="sm" ringColor={m.color} />
        ))}
        {overflow > 0 && (
          <span class="avatar avatar-sm app-header-overflow">+{overflow}</span>
        )}
      </button>

      <div class="app-header-actions">
        <button
          type="button"
          class="btn btn-icon btn-tonal"
          aria-label={t("header.share")}
          onClick={() => setShowQr(true)}
        >
          <Share aria-hidden="true" />
        </button>
        <button
          type="button"
          class="btn btn-icon"
          aria-label={t("header.leave")}
          onClick={() => setConfirmLeave(true)}
        >
          <LogOut aria-hidden="true" />
        </button>
      </div>

      {showQr && <QrModal roomId={session.roomId} onClose={() => setShowQr(false)} />}

      {showMembers && (
        <div class="modal-backdrop" onClick={() => setShowMembers(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            <div class="sheet-header">
              <p class="title-ornate">{t("header.membersLabel")}</p>
              <button
                type="button"
                class="btn btn-icon"
                aria-label={t("qr.close")}
                onClick={() => setShowMembers(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div class="sheet-body">
              {members.map((m) => (
                <div key={m.id} class="list-item">
                  <Avatar member={m} size="md" ringColor={m.color} />
                  <div class="list-item-body">
                    <span class="list-item-title">{m.name}</span>
                  </div>
                  {m.id === profile.id && <span class="chip chip-text app-header-you">{t("header.you")}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div class="modal-backdrop" onClick={() => setConfirmLeave(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            <div class="sheet-body">
              <p class="title-ornate">{t("header.leaveConfirmTitle")}</p>
              <p class="sheet-hint">{t("header.leaveConfirmBody")}</p>
              <div class="sheet-actions">
                <button type="button" class="btn btn-block" onClick={() => setConfirmLeave(false)}>
                  {t("header.leaveConfirmCancel")}
                </button>
                <button
                  type="button"
                  class="btn btn-danger btn-block"
                  onClick={() => {
                    setConfirmLeave(false);
                    void leaveRoom();
                  }}
                >
                  {t("header.leaveConfirmYes")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

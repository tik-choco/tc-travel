import "./shell.i18n";
import { useState } from "preact/hooks";
import { Share, LogOut } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useSession, useMembers, leaveRoom } from "../../lib/store";
import { QrModal } from "../room/QrModal";

export function Header() {
  const t = useT();
  const session = useSession();
  const members = useMembers();
  const [showQr, setShowQr] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!session) return null;

  const shownMembers = members.slice(0, 4);
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
      <div class="app-header-members" aria-label={t("header.membersLabel")}>
        {shownMembers.map((m) => (
          <span
            key={m.id}
            class="avatar avatar-sm"
            style={{ borderColor: m.color }}
            title={m.name}
          >
            {m.avatarEmoji}
          </span>
        ))}
        {overflow > 0 && <span class="avatar avatar-sm">+{overflow}</span>}
      </div>
      <div class="app-header-actions">
        <button
          type="button"
          class="btn btn-icon"
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

      {confirmLeave && (
        <div class="confirm-popover" role="alertdialog">
          <div class="panel confirm-popover-body">
            <p class="title-ornate">{t("header.leaveConfirmTitle")}</p>
            <p>{t("header.leaveConfirmBody")}</p>
            <div class="confirm-popover-actions">
              <button type="button" class="btn" onClick={() => setConfirmLeave(false)}>
                {t("header.leaveConfirmCancel")}
              </button>
              <button
                type="button"
                class="btn btn-danger"
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
      )}
    </header>
  );
}

import "./room.i18n";
import { useState } from "preact/hooks";
import { ScanLine, Plus, Users, ChevronRight, ArrowRight } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useJoinedRooms, useProfile } from "../../lib/personal";
import { createRoom, joinRoom } from "../../lib/store";
import { parseJoinInput } from "../../lib/qr";
import { Avatar } from "../common/Avatar";
import { QrModal } from "./QrModal";

const ROOM_EMOJI_CHOICES = ["🏕️", "🎉", "🗺️", "🏔️", "⚓", "🌲", "🏯", "🍻"];

export function Home() {
  const t = useT();
  const [profile] = useProfile();
  const joinedRooms = useJoinedRooms();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmoji, setCreateEmoji] = useState(ROOM_EMOJI_CHOICES[0]);
  const [creating, setCreating] = useState(false);

  const [joinText, setJoinText] = useState("");
  const [joinError, setJoinError] = useState(false);
  const [joining, setJoining] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const trimmed = createName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      await createRoom(trimmed, createEmoji);
      setCreateName("");
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (e: Event) => {
    e.preventDefault();
    if (joining) return;
    const id = parseJoinInput(joinText.trim());
    if (!id) {
      setJoinError(true);
      return;
    }
    setJoinError(false);
    setJoining(true);
    try {
      await joinRoom(id);
      setJoinText("");
    } catch (err) {
      console.error("tc-travel: joinRoom failed", err);
      setJoinError(true);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div class="screen" aria-label={t("home.title")}>
      <div class="home-hero">
        <Avatar self size="lg" />
        <p class="home-hero-greeting">{t("home.greeting", { name: profile.name })}</p>
      </div>

      <div class="home-actions">
        <button type="button" class="home-action-card" onClick={() => setScanOpen(true)}>
          <span class="home-action-icon" aria-hidden="true">
            <ScanLine />
          </span>
          <span class="home-action-title">{t("home.scanCardTitle")}</span>
          <span class="home-action-sub">{t("home.scanCardSub")}</span>
        </button>
        <button type="button" class="home-action-card" onClick={() => setCreateOpen(true)}>
          <span class="home-action-icon" aria-hidden="true">
            <Plus />
          </span>
          <span class="home-action-title">{t("home.createCardTitle")}</span>
          <span class="home-action-sub">{t("home.createCardSub")}</span>
        </button>
      </div>

      <form class="home-join-row" onSubmit={handleJoin}>
        <input
          class="input"
          type="text"
          value={joinText}
          placeholder={t("home.joinPlaceholder")}
          onInput={(e) => {
            setJoinError(false);
            setJoinText((e.target as HTMLInputElement).value);
          }}
        />
        <button
          type="submit"
          class="btn btn-icon"
          aria-label={t("home.joinSubmit")}
          disabled={joining || !joinText.trim()}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </form>
      {joinError && <p class="home-join-error">{t("home.joinError")}</p>}

      <p class="section-title">{t("home.yourParties")}</p>
      {joinedRooms.length === 0 ? (
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">
            <Users />
          </span>
          <p class="empty-state-title">{t("home.emptyPartiesTitle")}</p>
          <p class="empty-state-hint">{t("home.joinedRoomsEmpty")}</p>
        </div>
      ) : (
        <div class="home-parties">
          {joinedRooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              class="list-item"
              onClick={() => void joinRoom(room.roomId)}
            >
              <span class="avatar" aria-hidden="true">
                <Users />
              </span>
              <div class="list-item-body">
                <span class="list-item-title">{room.name}</span>
                <span class="list-item-sub">{new Date(room.lastOpened).toLocaleDateString()}</span>
              </div>
              <span class="list-item-trailing" aria-hidden="true">
                <ChevronRight />
              </span>
            </button>
          ))}
        </div>
      )}

      {createOpen && (
        <div class="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            <form class="sheet-body" onSubmit={handleCreate}>
              <p class="title-ornate">{t("home.createTitle")}</p>
              <div class="field">
                <input
                  class="input"
                  type="text"
                  maxLength={40}
                  value={createName}
                  placeholder={t("home.createNamePlaceholder")}
                  onInput={(e) => setCreateName((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="field">
                <label>{t("home.createEmojiLabel")}</label>
                <div class="emoji-grid">
                  {ROOM_EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      class={`chip${createEmoji === emoji ? " is-selected" : ""}`}
                      aria-pressed={createEmoji === emoji}
                      aria-label={emoji}
                      onClick={() => setCreateEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit" class="btn btn-primary btn-block" disabled={creating || !createName.trim()}>
                {t("home.createSubmit")}
              </button>
            </form>
          </div>
        </div>
      )}

      {scanOpen && <QrModal roomId="" initialTab="scan" onClose={() => setScanOpen(false)} />}
    </div>
  );
}

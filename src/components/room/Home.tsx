import "./room.i18n";
import { useState } from "preact/hooks";
import { Scan } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useJoinedRooms } from "../../lib/personal";
import { createRoom, joinRoom } from "../../lib/store";
import { parseJoinInput } from "../../lib/qr";
import { QrModal } from "./QrModal";

const ROOM_EMOJI_CHOICES = ["🏕️", "🎉", "🗺️", "🏔️", "⚓", "🌲", "🏯", "🍻"];

export function Home() {
  const t = useT();
  const joinedRooms = useJoinedRooms();

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
    <div class="screen">
      <p class="title-ornate">{t("home.title")}</p>

      <div class="quest-board">
        {joinedRooms.length === 0 ? (
          <p class="quest-board-empty">{t("home.joinedRoomsEmpty")}</p>
        ) : (
          joinedRooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              class="panel panel-tight quest-card"
              onClick={() => void joinRoom(room.roomId)}
            >
              <div class="quest-card-info">
                <span class="quest-card-name">{room.name}</span>
                <span class="quest-card-meta">
                  {new Date(room.lastOpened).toLocaleDateString()}
                </span>
              </div>
              <span class="btn btn-primary">{t("home.enter")}</span>
            </button>
          ))
        )}
      </div>

      <div class="home-section">
        <h2>{t("home.createTitle")}</h2>
        <form class="panel" onSubmit={handleCreate}>
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

      <div class="home-section">
        <h2>{t("home.joinTitle")}</h2>
        <form class="panel" onSubmit={handleJoin}>
          <div class="join-row">
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
            <button type="button" class="btn btn-icon" aria-label={t("home.joinScan")} onClick={() => setScanOpen(true)}>
              <Scan aria-hidden="true" />
            </button>
          </div>
          {joinError && <p style={{ color: "var(--seal)", marginTop: "0.5rem" }}>{t("home.joinError")}</p>}
          <button
            type="submit"
            class="btn btn-primary btn-block"
            style={{ marginTop: "0.75rem" }}
            disabled={joining || !joinText.trim()}
          >
            {t("home.joinSubmit")}
          </button>
        </form>
      </div>

      {scanOpen && (
        <QrModal roomId="" initialTab="scan" onClose={() => setScanOpen(false)} />
      )}
    </div>
  );
}

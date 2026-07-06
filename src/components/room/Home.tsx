import "./room.i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { ScanLine, Plus, Users, ChevronRight, ArrowRight, Camera, Sparkles } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useJoinedRooms, useProfile } from "../../lib/personal";
import { createRoom, joinRoom } from "../../lib/store";
import { setProfileAvatar } from "../../lib/avatar";
import { parseJoinInput } from "../../lib/qr";
import { loadVrmBytes } from "../ar/vrmStorage";
import { Avatar } from "../common/Avatar";
import { QrModal } from "./QrModal";
import { AvatarSheet } from "./AvatarSheet";
import { HomeVrmStageLazy } from "./HomeVrmStageLazy";

const ROOM_EMOJI_CHOICES = ["🏕️", "🎉", "🗺️", "🏔️", "⚓", "🌲", "🏯", "🍻"];

/** Time-of-day greeting key so opening the app feels like being welcomed home. */
function greetingKey(hour: number): string {
  if (hour < 5 || hour >= 22) return "home.greetNight";
  if (hour < 12) return "home.greetMorning";
  if (hour < 18) return "home.greetAfternoon";
  return "home.greetEvening";
}

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

  // The generated default profile name is non-empty, so a first-time user skips
  // ProfileSetup and lands straight here — make the hero avatar itself the entry
  // point for setting a real, personal portrait (attachment starts with "that's me").
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // 3D companion hero: VRM bytes resolve async from IndexedDB, so the portrait
  // always renders first and upgrades to the stage when a VRM is found —
  // never block the landing screen on storage.
  const [vrmBytes, setVrmBytes] = useState<Uint8Array | null>(null);
  const [vrmChecked, setVrmChecked] = useState(false);
  const [vrmFailed, setVrmFailed] = useState(false);
  const [vrmVersion, setVrmVersion] = useState(0);
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    loadVrmBytes()
      .then((bytes) => {
        if (alive) setVrmBytes(bytes);
      })
      .catch(() => {
        // IndexedDB unavailable (private mode etc.) — keep the portrait hero.
      })
      .finally(() => {
        if (alive) setVrmChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [vrmVersion]);
  const hasVrm = vrmBytes !== null;
  const handleAvatarFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    try {
      await setProfileAvatar(file);
    } catch (err) {
      console.error("tc-travel: setProfileAvatar failed", err);
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

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
        {profile.showHomeVrm !== false && !vrmFailed && vrmBytes ? (
          // The 3D companion greets you; tapping it opens avatar management.
          <button
            type="button"
            class="home-vrm-stage"
            aria-label={t("home.avatarManage")}
            onClick={() => setAvatarSheetOpen(true)}
          >
            <HomeVrmStageLazy key={vrmVersion} bytes={vrmBytes} onError={() => setVrmFailed(true)} />
          </button>
        ) : (
          // Portrait fallback. Once a VRM exists (hidden or broken), the tap
          // routes to the management sheet instead of the raw photo picker so
          // the toggle stays reachable from Home.
          <button
            type="button"
            class="home-hero-avatar"
            disabled={avatarBusy}
            aria-label={t("home.avatarManage")}
            onClick={() => setAvatarSheetOpen(true)}
          >
            <Avatar self size="xl" />
            {!profile.avatarImage && (
              <span class="home-hero-avatar-badge" aria-hidden="true">
                <Camera />
              </span>
            )}
          </button>
        )}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          class="visually-hidden"
          onChange={handleAvatarFile}
          aria-label={t("home.setAvatar")}
        />
        <p class="home-hero-greeting">{t(greetingKey(new Date().getHours()), { name: profile.name })}</p>
        <p class="home-hero-tagline">{t("home.heroTagline")}</p>
        {vrmFailed && <p class="home-vrm-error">{t("home.vrmLoadError")}</p>}
        {vrmChecked && !hasVrm && (
          <button type="button" class="home-vrm-cta" onClick={() => setAvatarSheetOpen(true)}>
            <Sparkles aria-hidden="true" />
            {t("home.vrmCta")}
          </button>
        )}
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

      {avatarSheetOpen && (
        <AvatarSheet
          hasVrm={hasVrm}
          onClose={() => setAvatarSheetOpen(false)}
          onVrmChanged={() => {
            // Re-read storage and give a fresh VRM another chance to parse.
            setVrmFailed(false);
            setVrmVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

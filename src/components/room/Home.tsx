import "./room.i18n";
import "./homeFirstSteps.css";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ScanLine,
  Plus,
  Users,
  ChevronRight,
  ArrowRight,
  Camera,
  Sparkles,
  Flame,
  Target,
  BookOpen,
} from "lucide-preact";
import { getLanguage, useT } from "../../lib/i18n";
import { useJoinedRooms, useProfile } from "../../lib/personal";
import { useJourneyStats } from "../../lib/journeyStats";
import { useUnlocks, nextUnlock } from "../../lib/unlocks";
import { nextGoal } from "../../lib/gamification";
import { createRoom, joinRoom } from "../../lib/store";
import { setProfileAvatar } from "../../lib/avatar";
import { parseJoinInput } from "../../lib/qr";
import { loadVrmBytes } from "../ar/vrmStorage";
import { maybeAdoptFamilyVrm } from "../../lib/familyVrm";
import { Avatar } from "../common/Avatar";
import { tWithFallback } from "../guild/fallback";
import { QrModal } from "./QrModal";
import { AvatarSheet } from "./AvatarSheet";
import { HomeVrmStageLazy } from "./HomeVrmStageLazy";
import { SoloWelcome } from "./SoloWelcome";
import { hasLocalMemories } from "../../lib/local/localMemories";

const ROOM_EMOJI_CHOICES = ["🏕️", "🎉", "🗺️", "🏔️", "⚓", "🌲", "🏯", "🍻"];

/** Time-of-day greeting key so opening the app feels like being welcomed home. */
function greetingKey(hour: number): string {
  if (hour < 5 || hour >= 22) return "home.greetNight";
  if (hour < 12) return "home.greetMorning";
  if (hour < 18) return "home.greetAfternoon";
  return "home.greetEvening";
}

export function Home({
  onStartJourney,
  onOpenAvatar,
  onOpenDiary,
}: {
  onStartJourney?: () => void;
  /** Switches the app to the `avatar` tab — the AR photo shortcut's target
   *  (there is no direct "launch the camera" API to jump deeper than that,
   *  and the avatar/AR internals are out of scope here; see AvatarScreen's
   *  own "AR撮影" CTA for the actual capture launch). */
  onOpenAvatar?: () => void;
  /** Switches the app to the `diary` tab — the "write a diary entry" first-step target. */
  onOpenDiary?: () => void;
}) {
  const t = useT();
  const [profile] = useProfile();
  const joinedRooms = useJoinedRooms();

  // Home is the reliable return surface (the room session is lost on reload), so
  // it's where "your journey at a glance" belongs — rank, streak and the next
  // goal, all derived from the same shared stats the Guild and map use.
  const { stats, rank } = useJourneyStats();
  // The Home companion sleeps as a still portrait until the journey begins
  // (companionWake unlock); its first breath is the reward for the first entry.
  const { companionWake } = useUnlocks();
  const goal = nextGoal(stats);
  const anticipate = nextUnlock(stats);
  // One nudge at a time — this is a cozy journal, not a stats dashboard, so we
  // don't stack two progress lines. Prefer the unlock whisper when the companion
  // is still asleep (the first-session moment to look forward to) or when the
  // nearest unlock is at least as imminent as the nearest achievement goal;
  // otherwise the achievement goal keeps the slot.
  const showUnlockNudge =
    anticipate !== null &&
    (anticipate.def.id === "companionWake" || goal === null || anticipate.remaining <= goal.remaining);
  const xpPct =
    rank.xpForNextLevel > 0 ? Math.min(100, Math.round((rank.xpIntoLevel / rank.xpForNextLevel) * 100)) : 100;

  // A brand-new user (no local memories, no parties, no XP yet) hasn't done
  // anything the rank/streak strip could show off — leading with it just
  // buries "what do I do now?" under empty numbers. For this window only, the
  // "first steps" quick-start replaces it near the top and the progress strip
  // collapses to its single nudge line (still worth keeping: for a fresh
  // traveller that line IS the companionWake whisper — "someone might stir
  // awake" — which is exactly the forward-looking hook onboarding wants).
  // Anyone with any of the three signals already has a journey underway, so
  // they keep the existing layout untouched.
  const isNewUser = joinedRooms.length === 0 && !hasLocalMemories() && rank.xp === 0;

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
  const [vrmFailed, setVrmFailed] = useState(false);
  const [vrmVersion, setVrmVersion] = useState(0);
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    loadVrmBytes()
      .then(async (bytes) => {
        if (bytes) {
          if (alive) setVrmBytes(bytes);
          return;
        }
        // No local VRM yet — adopt one already shared in the tik-choco family
        // (e.g. set in tc-vrm-viewer) so it just greets you without re-uploading.
        const adopted = await maybeAdoptFamilyVrm().catch(() => false);
        if (!alive) return;
        setVrmBytes(adopted ? await loadVrmBytes().catch(() => null) : null);
      })
      .catch(() => {
        // IndexedDB unavailable (private mode etc.) — keep the portrait hero.
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
        {profile.showHomeVrm !== false ? (
          // The 3D companion always greets you — a VRM if you've loaded one, the
          // placeholder golem otherwise (or when a VRM failed to parse), so the
          // wake-up reward is never invisible. Tapping it opens avatar management.
          <button
            type="button"
            class="home-vrm-stage"
            aria-label={t("home.avatarManage")}
            onClick={() => setAvatarSheetOpen(true)}
          >
            <HomeVrmStageLazy
              key={vrmVersion}
              bytes={vrmFailed ? undefined : (vrmBytes ?? undefined)}
              animate={companionWake}
              onError={() => setVrmFailed(true)}
            />
          </button>
        ) : (
          // The 3D companion is toggled off (showHomeVrm === false) — show the
          // photo portrait instead, and route taps to the management sheet so
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
      </div>

      {/* Priority slot: a brand-new traveller gets the three first-move
          actions (the "what do I do now?" answer); everyone else gets a
          quieter, always-available 1-tap shortcut to the flagship AR photo
          feature, which otherwise sits two taps deep (avatar tab, then its
          own CTA). */}
      {isNewUser ? (
        <section class="home-first-steps" aria-label={t("home.firstStepsLabel")}>
          <p class="home-first-steps-title">{t("home.firstStepsTitle")}</p>
          <div class="home-first-steps-grid">
            <button type="button" class="home-first-step" onClick={() => onOpenAvatar?.()}>
              <span class="home-first-step-icon" aria-hidden="true">
                <Camera />
              </span>
              <span class="home-first-step-label">{t("home.firstStepAr")}</span>
            </button>
            <button type="button" class="home-first-step" onClick={() => onOpenDiary?.()}>
              <span class="home-first-step-icon" aria-hidden="true">
                <BookOpen />
              </span>
              <span class="home-first-step-label">{t("home.firstStepDiary")}</span>
            </button>
            <button type="button" class="home-first-step" onClick={() => setScanOpen(true)}>
              <span class="home-first-step-icon" aria-hidden="true">
                <Users />
              </span>
              <span class="home-first-step-label">{t("home.firstStepJoin")}</span>
            </button>
          </div>
        </section>
      ) : (
        <button type="button" class="home-ar-shortcut" onClick={() => onOpenAvatar?.()}>
          <span class="home-ar-shortcut-icon" aria-hidden="true">
            <Camera size={18} />
          </span>
          <span class="home-ar-shortcut-label">{t("home.arShortcut")}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      <section
        class={`home-progress${isNewUser ? " home-progress-compact" : ""}`}
        aria-label={t("home.journeyLabel")}
      >
        {!isNewUser && (
          <>
            <div class="home-progress-top">
              <span class="home-progress-rank">
                <span class="chip home-progress-level">{t("home.levelShort", { level: rank.level })}</span>
                <span class="home-progress-title">{t(rank.titleKey)}</span>
              </span>
              <span class={`home-progress-streak${stats.streakDays > 0 ? " is-active" : ""}`}>
                <Flame size={14} aria-hidden="true" />
                {stats.streakDays > 0 ? t("home.streakDays", { days: stats.streakDays }) : t("home.streakStart")}
              </span>
            </div>
            <div
              class="home-progress-xp"
              role="progressbar"
              aria-valuenow={xpPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div class="home-progress-xp-fill" style={{ width: `${xpPct}%` }} />
            </div>
          </>
        )}
        {showUnlockNudge && anticipate ? (
          <p class="home-progress-whisper">
            <Sparkles size={13} aria-hidden="true" />
            <span>{t(anticipate.tier.upcomingKey, { remaining: anticipate.remaining })}</span>
          </p>
        ) : (
          <p class="home-progress-goal">
            <Target size={13} aria-hidden="true" />
            <span>
              {goal
                ? t("home.nextGoal", {
                    remaining: goal.remaining,
                    title: tWithFallback(t, goal.def.titleKey, goal.def.id),
                  })
                : t("home.allGoalsDone")}
            </span>
          </p>
        )}
      </section>

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

      {/* A warm nudge to begin (or keep going) alone — shown for as long as no
          party has been joined, not just in the first instant, since going
          solo is a whole valid mode, not a one-time hiccup. It carries its
          own dismiss (✕), persisted, for anyone who'd rather not see it again. */}
      {joinedRooms.length === 0 && <SoloWelcome onStart={onStartJourney} />}

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
                <span class="list-item-sub">{new Date(room.lastOpened).toLocaleDateString(getLanguage())}</span>
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

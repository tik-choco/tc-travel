// Avatar hub: your companion's home. No VRM yet → a welcoming empty-state
// hero. Once summoned (or the placeholder golem is entered explicitly), the
// camera + three.js overlay becomes "home base" — gestures, the AR composite
// photo capture, and a NEW "set as profile portrait" action that renders the
// companion (over a plain backdrop, no camera feed) into the user's identity
// image everywhere else in the app.

import "./ar.i18n";
import "./ar.css";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  Camera as CameraIcon,
  Download,
  HardDrive,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  RotateCw,
  Smartphone,
  Sparkles,
  SwitchCamera,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-preact";
import { useT } from "../../lib/i18n";
import {
  useSession,
  addPhoto,
  useMembers,
  sendCompanionPose,
  onCompanionPose,
  setMemberVrmBytes,
  useMemberVrmCids,
} from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { compressImage } from "../../lib/photo";
import { lookupCountry } from "../../lib/geo";
import { setProfileAvatar } from "../../lib/avatar";
import { listDriveFiles, loadDriveFileBytes, type DriveFileEntry } from "../../lib/drive/reader";
import type { GeoPoint } from "../../lib/types";
import type { Companion } from "./companion";
import { createArScene, type ArScene } from "./arScene";
import { createPlaceholderCompanion } from "./placeholderCompanion";
import { createVrmCompanion, loadVrmFromBytes } from "./vrmLoader";
import { attachGestures, rotateStep, zoomStep, type GestureHandle } from "./gestures";
import { loadVrmBytes, saveVrmBytes, clearVrmBytes } from "./vrmStorage";
import { createRemoteCompanions, type RemoteCompanionsManager } from "./remoteCompanions";
import { isAiConfigured } from "../../lib/ai/aiSettings";
import { getCompanionClient } from "../../lib/ai/companionClient";
import { CompanionTalkPanel } from "./CompanionTalkPanel";

const ROTATE_STEP = Math.PI / 12;
const ZOOM_STEP_FACTOR = 1.15;
const TOAST_DEFAULT_MS = 3200;
const TOAST_SHORT_MS = 2000;
/** Outbound companion-pose broadcast rate (see docs/ar-pose-sync.md). */
const POSE_SEND_INTERVAL_MS = 100;
/** Slot spacing for the initial no-overlap placement (docs/ar-pose-sync.md item 5). */
const INITIAL_SLOT_SPACING = 0.9;

type FacingMode = "environment" | "user";
/** "checking" = reading IndexedDB for a stored VRM; "empty" = the welcoming
 *  hero with no companion loaded yet; "live" = camera + 3D view is mounted. */
type ScreenMode = "checking" | "empty" | "live";

export function ARCameraScreen() {
  const t = useT();
  const session = useSession();
  const hasSession = session !== null;
  const [profile] = useProfile();
  const members = useMembers();
  const vrmCids = useMemberVrmCids();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const arSceneRef = useRef<ArScene | null>(null);
  const companionRef = useRef<Companion | null>(null);
  const gestureRef = useRef<GestureHandle | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const remoteCompanionsRef = useRef<RemoteCompanionsManager | null>(null);
  /** VRM bytes found in storage (or just picked) before the scene exists yet;
   *  the scene-creation effect consumes this once it mounts. */
  const pendingVrmBytesRef = useRef<Uint8Array | null>(null);
  /** Freshest hasSession/members/profile, readable from callbacks (e.g.
   *  swapCompanion) that must stay referentially stable across renders. */
  const liveContextRef = useRef({ hasSession, members, ownMemberId: profile.id });
  useEffect(() => {
    liveContextRef.current = { hasSession, members, ownMemberId: profile.id };
  }, [hasSession, members, profile.id]);
  // Mirror for the manager-creation effect, which must seed a fresh manager
  // with the current cid map without re-running on every cid change.
  const vrmCidsRef = useRef(vrmCids);
  useEffect(() => {
    vrmCidsRef.current = vrmCids;
  }, [vrmCids]);

  // Initial no-overlap placement (docs/ar-pose-sync.md item 5): only while in
  // a room and only if the companion hasn't been moved yet (still exactly at
  // the origin) — gesture-driven positions are never overwritten.
  function applyInitialCompanionOffset(): void {
    const { hasSession: active, members: currentMembers, ownMemberId } = liveContextRef.current;
    if (!active) return;
    const root = companionRef.current?.root;
    if (!root) return;
    if (root.position.x !== 0 || root.position.y !== 0 || root.position.z !== 0) return;
    const sortedIds = currentMembers.map((m) => m.id).sort();
    const index = sortedIds.indexOf(ownMemberId);
    if (index < 0) return;
    const n = sortedIds.length;
    root.position.x = (index - (n - 1) / 2) * INITIAL_SLOT_SPACING;
  }

  const [mode, setMode] = useState<ScreenMode>("checking");
  const [hasVrm, setHasVrm] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [retryToken, setRetryToken] = useState(0);
  const [cameraError, setCameraError] = useState(false);
  const [vrmLoading, setVrmLoading] = useState(false);
  /** Populated right before the sheet opens (handleLoadClick), from
   *  listDriveFiles — see the drive source picker below. */
  const [driveEntries, setDriveEntries] = useState<DriveFileEntry[]>([]);
  const [showVrmChooser, setShowVrmChooser] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [settingPortrait, setSettingPortrait] = useState(false);
  const [flash, setFlash] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<{ url: string } | null>(null);
  const [showTalkPanel, setShowTalkPanel] = useState(false);

  const showToast = useCallback((message: string, durationMs = TOAST_DEFAULT_MS) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // The AI companion connection is a page-wide singleton (shared mist node);
  // it's only torn down when this whole screen unmounts, not when the talk
  // panel closes or the live scene is recreated — see docs/ai-companion.md.
  useEffect(() => {
    return () => {
      getCompanionClient().disconnect();
    };
  }, []);

  // Fade the gesture hint after a few seconds.
  useEffect(() => {
    if (mode !== "live") return;
    setShowHint(true);
    const id = window.setTimeout(() => setShowHint(false), 4000);
    return () => window.clearTimeout(id);
  }, [mode]);

  // Revoke the previous save-to-device object URL whenever it's replaced or on unmount.
  useEffect(() => {
    return () => {
      if (lastShot) URL.revokeObjectURL(lastShot.url);
    };
  }, [lastShot]);

  // Check for a previously-stored VRM once on mount. No bytes → land on the
  // empty-state hero instead of eagerly requesting camera permission for a
  // feature the user hasn't opted into yet.
  useEffect(() => {
    let cancelled = false;
    loadVrmBytes()
      .then((bytes) => {
        if (cancelled) return;
        if (bytes) {
          pendingVrmBytesRef.current = bytes;
          setHasVrm(true);
          setMode("live");
        } else {
          setMode("empty");
        }
      })
      .catch(() => {
        if (!cancelled) setMode("empty");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Acquire the camera stream once live; re-runs on facing-mode flip or manual retry.
  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    let activeStream: MediaStream | null = null;
    setCameraError(false);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        activeStream = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) setCameraError(true);
      });

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [mode, facingMode, retryToken]);

  const swapCompanion = useCallback(async (factory: () => Promise<Companion>) => {
    const next = await factory();
    const arScene = arSceneRef.current;
    if (!arScene) {
      next.dispose();
      return;
    }
    const prev = companionRef.current;
    companionRef.current = next;
    arScene.setCompanion(next);
    applyInitialCompanionOffset();
    prev?.dispose();
  }, []);

  // Set up the three.js overlay once live, load any pending VRM, wire gestures.
  useEffect(() => {
    if (mode !== "live") return;
    const container = overlayRef.current;
    if (!container) return;

    const arScene = createArScene(container);
    arSceneRef.current = arScene;

    const placeholder = createPlaceholderCompanion();
    companionRef.current = placeholder;
    arScene.setCompanion(placeholder);
    applyInitialCompanionOffset();

    const gestures = attachGestures(arScene.canvas, arScene.camera, () => companionRef.current?.root ?? null);
    gestureRef.current = gestures;

    const pending = pendingVrmBytesRef.current;
    pendingVrmBytesRef.current = null;
    if (pending) {
      swapCompanion(() => loadVrmFromBytes(pending).then(createVrmCompanion)).catch(() => {
        showToast(t("ar.summonError"));
      });
    }

    return () => {
      gestures.dispose();
      gestureRef.current = null;
      companionRef.current?.dispose();
      companionRef.current = null;
      arScene.dispose();
      arSceneRef.current = null;
    };
  }, [mode, swapCompanion, showToast, t]);

  // Mirrors every other room member's companion onto the shared virtual
  // stage while live and in a room (group-photo mode) — see
  // docs/ar-pose-sync.md. Gated on hasSession (not the whole `session`
  // object) so this doesn't tear down/recreate on every unrelated doc
  // change; arSceneRef.current is already set because the scene-creation
  // effect above runs first within the same commit.
  useEffect(() => {
    if (mode !== "live" || !hasSession) return;
    const arScene = arSceneRef.current;
    if (!arScene) return;
    const manager = createRemoteCompanions(arScene, profile.id);
    remoteCompanionsRef.current = manager;
    // Seed the roster/cids the effects below only re-push on change — a
    // freshly (re)created manager must not wait for the next change to learn
    // the current room state.
    manager.setMembers(liveContextRef.current.members.map((m) => m.id));
    manager.setVrmCids(vrmCidsRef.current);
    const unsubscribe = onCompanionPose((pose) => manager.applyPose(pose));
    return () => {
      unsubscribe();
      manager.dispose();
      remoteCompanionsRef.current = null;
    };
  }, [mode, hasSession, profile.id]);

  useEffect(() => {
    remoteCompanionsRef.current?.setVrmCids(vrmCids);
  }, [vrmCids]);

  // Roster gate for the unauthenticated pose channel: only real members may
  // materialize as remote companions (see RemoteCompanionsManager.setMembers).
  useEffect(() => {
    remoteCompanionsRef.current?.setMembers(members.map((m) => m.id));
  }, [members]);

  // 10Hz outbound pose broadcast (docs/ar-pose-sync.md). sendCompanionPose
  // itself is a safe no-op outside a session, so this only needs to start/
  // stop with live mode.
  useEffect(() => {
    if (mode !== "live" || !hasSession) return;
    const intervalId = window.setInterval(() => {
      const root = companionRef.current?.root;
      if (!root) return;
      sendCompanionPose({
        x: root.position.x,
        y: root.position.y,
        z: root.position.z,
        ry: root.rotation.y,
        s: root.scale.x,
      });
    }, POSE_SEND_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [mode, hasSession]);

  // Late-arriving members still get a non-overlapping starting spot, as long
  // as the companion hasn't been moved yet.
  useEffect(() => {
    if (mode !== "live" || !hasSession) return;
    applyInitialCompanionOffset();
  }, [mode, hasSession, members, profile.id]);

  function handleFlip(): void {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }

  function handleRetry(): void {
    setRetryToken((n) => n + 1);
  }

  // Adopts freshly-picked VRM bytes into the live scene (or stashes them for
  // the scene-creation effect if it isn't mounted yet) and persists them —
  // shared by both the device file input and the drive picker below.
  const applyVrmBytes = useCallback(
    async (bytes: Uint8Array): Promise<void> => {
      if (mode === "live" && arSceneRef.current) {
        await swapCompanion(() => loadVrmFromBytes(bytes).then(createVrmCompanion));
      } else {
        // Scene isn't mounted yet (coming from the empty-state hero) — stash
        // the bytes and the scene-creation effect will pick them up.
        pendingVrmBytesRef.current = bytes;
        setMode("live");
      }
      await saveVrmBytes(bytes).catch(() => undefined);
      setHasVrm(true);
      setMemberVrmBytes(bytes).catch((err) => console.warn("tc-travel: failed to publish companion VRM", err));
    },
    [mode, swapCompanion],
  );

  // Both the empty-state hero button and the live-mode upload button land
  // here. A drive with at least one .vrm file gets a chooser sheet (device
  // vs. drive); otherwise behavior is unchanged — straight to the native
  // file picker.
  function handleLoadClick(): void {
    const entries = listDriveFiles({ extensions: [".vrm"] });
    if (entries.length > 0) {
      setDriveEntries(entries);
      setShowVrmChooser(true);
      return;
    }
    fileInputRef.current?.click();
  }

  function handleChooseFromDevice(): void {
    setShowVrmChooser(false);
    fileInputRef.current?.click();
  }

  async function handleChooseDriveEntry(entry: DriveFileEntry): Promise<void> {
    setShowVrmChooser(false);
    setVrmLoading(true);
    try {
      const bytes = await loadDriveFileBytes(entry);
      await applyVrmBytes(bytes);
    } catch (err) {
      console.error(err);
      showToast(t("ar.summonError"));
    } finally {
      setVrmLoading(false);
    }
  }

  async function handleFileChange(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    setVrmLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await applyVrmBytes(bytes);
    } catch (err) {
      console.error(err);
      showToast(t("ar.summonError"));
    } finally {
      setVrmLoading(false);
    }
  }

  async function handleRemoveVrm(): Promise<void> {
    await clearVrmBytes().catch(() => undefined);
    await swapCompanion(() => Promise.resolve(createPlaceholderCompanion()));
    setHasVrm(false);
    showToast(t("ar.removed"));
  }

  function handleRotate(direction: 1 | -1): void {
    const root = companionRef.current?.root;
    if (root) rotateStep(root, direction * ROTATE_STEP);
  }

  function handleZoom(factor: number): void {
    const arScene = arSceneRef.current;
    const root = companionRef.current?.root;
    if (root && arScene) zoomStep(root, arScene.camera, factor);
  }

  async function resolveGeo(): Promise<GeoPoint | null> {
    const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      const timer = window.setTimeout(() => resolve(null), 5000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          window.clearTimeout(timer);
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          window.clearTimeout(timer);
          resolve(null);
        },
        { timeout: 5000, maximumAge: 60000 },
      );
    });
    if (!coords) return null;
    const countryCode = await lookupCountry(coords.lat, coords.lng).catch(() => "");
    return { lat: coords.lat, lng: coords.lng, countryCode };
  }

  async function handleCapture(): Promise<void> {
    const video = videoRef.current;
    const arScene = arSceneRef.current;
    if (!arScene || capturing) return;
    // No camera is not a blocker: fall back to a virtual-stage shot (dark
    // backdrop + the 3D overlay) so the feature stays usable when camera
    // permission is denied or no camera exists.
    const frameVideo = video && video.videoWidth > 0 && video.videoHeight > 0 ? video : null;

    setCapturing(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);

    try {
      let sw: number;
      let sh: number;
      const canvas = document.createElement("canvas");
      const draw = (ctx: CanvasRenderingContext2D) => {
        ctx.drawImage(arScene.canvas, 0, 0, arScene.canvas.width, arScene.canvas.height, 0, 0, sw, sh);
      };

      if (frameVideo) {
        // Crop the native video frame the same way `object-fit: cover` crops
        // it for display, so the capture matches what's on screen.
        const rect = frameVideo.getBoundingClientRect();
        const screenAspect = rect.width / rect.height;
        const videoW = frameVideo.videoWidth;
        const videoH = frameVideo.videoHeight;
        const videoAspect = videoW / videoH;

        let sx: number;
        let sy: number;
        if (videoAspect > screenAspect) {
          sh = videoH;
          sw = videoH * screenAspect;
          sx = (videoW - sw) / 2;
          sy = 0;
        } else {
          sw = videoW;
          sh = videoW / screenAspect;
          sx = 0;
          sy = (videoH - sh) / 2;
        }
        sw = Math.round(sw);
        sh = Math.round(sh);
        sx = Math.round(sx);
        sy = Math.round(sy);

        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D context unavailable");
        ctx.drawImage(frameVideo, sx, sy, sw, sh, 0, 0, sw, sh);
        draw(ctx);
      } else {
        // Virtual-stage shot at the overlay's own resolution, over the same
        // gradient the on-screen .ar-stage-backdrop shows.
        sw = arScene.canvas.width;
        sh = arScene.canvas.height;
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D context unavailable");
        const gradient = ctx.createLinearGradient(0, 0, 0, sh);
        gradient.addColorStop(0, "#1b2030");
        gradient.addColorStop(1, "#0c0e16");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, sw, sh);
        draw(ctx);
      }

      const { bytes, width, height } = await compressImage(canvas);
      const geo = await resolveGeo();

      if (session) {
        await addPhoto(bytes, { caption: "", geo, width, height, arShot: true });
        showToast(t("ar.toastRecorded"));
      } else {
        showToast(t("ar.joinHint"));
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (blob) setLastShot({ url: URL.createObjectURL(blob) });
    } catch (err) {
      console.error(err);
    } finally {
      setCapturing(false);
    }
  }

  function handleSaveToDevice(): void {
    if (!lastShot) return;
    const a = document.createElement("a");
    a.href = lastShot.url;
    a.download = `tc-travel-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(t("ar.toastSaved"));
  }

  // Renders the companion alone (no camera feed) over a plain token-colored
  // backdrop, cropped to a top-anchored square so the head is never clipped,
  // and hands the blob to the shared avatar pipeline (further compression /
  // cover-crop to <=256px happens there) — this is the emotional payoff: the
  // avatar users are attached to becomes their identity across the app.
  async function handleSetProfilePortrait(): Promise<void> {
    const arScene = arSceneRef.current;
    if (!arScene || !hasVrm || settingPortrait) return;

    setSettingPortrait(true);
    try {
      const source = arScene.canvas;
      const side = Math.min(source.width, source.height);
      const sx = Math.round((source.width - side) / 2);

      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D context unavailable");

      const backdrop = getComputedStyle(document.documentElement).getPropertyValue("--surface-container-high").trim();
      ctx.fillStyle = backdrop || "#24242f";
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(source, sx, 0, side, side, 0, 0, side, side);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("toBlob failed");
      await setProfileAvatar(blob);
      showToast(t("ar.portraitSaved"), TOAST_SHORT_MS);
    } catch (err) {
      console.error(err);
      showToast(t("ar.portraitError"), TOAST_SHORT_MS);
    } finally {
      setSettingPortrait(false);
    }
  }

  const fileInput = (
    <input ref={fileInputRef} type="file" accept=".vrm" class="ar-file-input" onChange={handleFileChange} />
  );

  // "Device" vs. "Drive" source picker — only ever opened when driveEntries
  // is non-empty (handleLoadClick skips straight to the native file input
  // otherwise).
  const vrmChooserSheet = showVrmChooser && (
    <div
      class="modal-backdrop"
      onClick={() => setShowVrmChooser(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t("ar.chooserTitle")}
    >
      <div class="modal-card" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="ar-chooser-header">
          <p class="title-ornate">{t("ar.chooserTitle")}</p>
          <button
            type="button"
            class="btn btn-icon"
            aria-label={t("ar.chooserClose")}
            onClick={() => setShowVrmChooser(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div class="ar-chooser-body">
          <button type="button" class="list-item" onClick={handleChooseFromDevice}>
            <Smartphone size={20} aria-hidden="true" />
            <span class="list-item-body">
              <span class="list-item-title">{t("ar.chooserFromDevice")}</span>
            </span>
          </button>

          <p class="ar-chooser-section-label">
            <HardDrive size={14} aria-hidden="true" />
            {t("ar.chooserFromDrive")}
          </p>
          {driveEntries.map((entry) => {
            const sub = entry.path || t("ar.chooserRootFolder");
            return (
              <button
                key={entry.id}
                type="button"
                class="list-item"
                onClick={() => handleChooseDriveEntry(entry)}
              >
                <span class="list-item-body">
                  <span class="list-item-title">{entry.name}</span>
                  <span class="list-item-sub">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (mode === "checking") {
    return (
      <div class="ar-screen ar-screen-loading">
        {fileInput}
        <LoaderCircle class="spin" size={28} />
      </div>
    );
  }

  if (mode === "empty") {
    return (
      <div class="ar-screen ar-screen-empty">
        {fileInput}
        {vrmChooserSheet}
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">
            <Sparkles />
          </span>
          <p class="empty-state-title">{t("ar.emptyTitle")}</p>
          <p class="empty-state-hint">{t("ar.emptyHint")}</p>
          <button type="button" class="btn btn-primary" onClick={handleLoadClick} disabled={vrmLoading}>
            {vrmLoading ? <LoaderCircle class="spin" size={18} /> : <Upload size={18} />}
            {t("ar.summonBtn")}
          </button>
          <button type="button" class="btn btn-ghost" onClick={() => setMode("live")} disabled={vrmLoading}>
            {t("ar.tryPlaceholder")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="ar-screen">
      {fileInput}
      {vrmChooserSheet}
      {hasVrm && isAiConfigured() && (
        <CompanionTalkPanel
          open={showTalkPanel}
          onClose={() => setShowTalkPanel(false)}
          companionRef={companionRef}
        />
      )}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} class="ar-video" playsInline muted autoPlay />
      {cameraError && <div class="ar-stage-backdrop" />}
      <div ref={overlayRef} class="ar-overlay" />

      <div class={`ar-hint${showHint ? "" : " hidden"}`}>{t("ar.hint")}</div>

      <div class="ar-topbar">
        <h1 class="ar-title">{t("ar.title")}</h1>
        <div class="ar-topbar-actions">
          {hasVrm && isAiConfigured() && (
            <button
              type="button"
              class="ar-icon-btn"
              onClick={() => setShowTalkPanel(true)}
              aria-label={t("ar.talk.open")}
            >
              <MessageCircle size={20} />
            </button>
          )}
          <button type="button" class="ar-icon-btn" onClick={handleFlip} aria-label={t("ar.flipCamera")}>
            <SwitchCamera size={20} />
          </button>
        </div>
      </div>

      {toast && <div class="ar-toast">{toast}</div>}
      {vrmLoading && <div class="ar-toast">{t("ar.summonLoading")}</div>}

      {lastShot && !vrmLoading && (
        <button type="button" class="ar-save-pill" onClick={handleSaveToDevice}>
          <Download size={16} />
          {t("ar.saveToDevice")}
        </button>
      )}

      <div class="ar-bottombar">
        <div class="ar-side-controls">
          <button type="button" class="ar-icon-btn" onClick={() => handleRotate(-1)} aria-label={t("ar.rotateLeft")}>
            <RotateCcw size={18} />
          </button>
          <button type="button" class="ar-icon-btn" onClick={() => handleZoom(1 / ZOOM_STEP_FACTOR)} aria-label={t("ar.moveCloser")}>
            <ZoomIn size={18} />
          </button>
          <button type="button" class="ar-icon-btn" onClick={() => handleZoom(ZOOM_STEP_FACTOR)} aria-label={t("ar.moveFarther")}>
            <ZoomOut size={18} />
          </button>
          <button type="button" class="ar-icon-btn" onClick={() => handleRotate(1)} aria-label={t("ar.rotateRight")}>
            <RotateCw size={18} />
          </button>
        </div>
        <div class="ar-action-row">
          <button type="button" class="ar-icon-btn" onClick={handleLoadClick} disabled={vrmLoading} aria-label={t("ar.summonBtn")}>
            <Upload size={20} />
          </button>
          {hasVrm && (
            <button
              type="button"
              class="ar-icon-btn"
              onClick={handleSetProfilePortrait}
              disabled={settingPortrait}
              aria-label={t("ar.setPortrait")}
            >
              {settingPortrait ? <LoaderCircle class="spin" size={20} /> : <ImagePlus size={20} />}
            </button>
          )}
          <button type="button" class="ar-shutter" onClick={handleCapture} disabled={capturing} aria-label={t("ar.capture")}>
            <CameraIcon size={28} />
          </button>
          {hasVrm && (
            <button type="button" class="ar-icon-btn" onClick={handleRemoveVrm} aria-label={t("ar.removeVrm")}>
              <Trash2 size={20} />
            </button>
          )}
        </div>
      </div>

      <div class={`ar-flash${flash ? " active" : ""}`} />

      {cameraError && (
        <div class="ar-camera-notice">
          <span>{t("ar.noCameraNotice")}</span>
          <button type="button" class="btn btn-ghost" onClick={handleRetry}>
            {t("ar.retry")}
          </button>
        </div>
      )}
    </div>
  );
}

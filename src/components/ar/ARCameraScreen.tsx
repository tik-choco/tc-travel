// Capture-only overlay: a fullscreen camera-feed experience launched from the
// Avatar hub (../avatar/AvatarScreen) via its "AR撮影" button. It composites the
// live camera <video> with a three.js overlay of your companion — plus every
// other party member's companion mirrored onto a shared virtual stage — and
// shoots an AR composite photo (docs/ar-pose-sync.md). It renders fixed over
// the whole shell (including the tab bar) and dismisses via onClose.
//
// The avatar-management concerns (summon/import, remove, set-portrait, talk)
// live in the hub now; this screen only reads the stored VRM to render it, and
// falls back to the placeholder golem when none is stored.

import "./ar.i18n";
import "./ar.css";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  Camera as CameraIcon,
  Download,
  RotateCcw,
  RotateCw,
  SwitchCamera,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-preact";
import { useT } from "../../lib/i18n";
import {
  useSession,
  useMembers,
  sendCompanionPose,
  onCompanionPose,
  useMemberVrmCids,
} from "../../lib/store";
import { addPhotoAuto } from "../../lib/memories";
import { useProfile } from "../../lib/personal";
import { compressImage } from "../../lib/photo";
import { lookupCountry } from "../../lib/geo";
import type { GeoPoint } from "../../lib/types";
import type { Companion } from "./companion";
import { createArScene, type ArScene } from "./arScene";
import { createPlaceholderCompanion } from "./placeholderCompanion";
import { createVrmCompanion, loadVrmFromBytes } from "./vrmLoader";
import { attachGestures, rotateStep, zoomStep, type GestureHandle } from "./gestures";
import { loadVrmBytes } from "./vrmStorage";
import { createRemoteCompanions, type RemoteCompanionsManager } from "./remoteCompanions";

const ROTATE_STEP = Math.PI / 12;
const ZOOM_STEP_FACTOR = 1.15;
const TOAST_DEFAULT_MS = 3200;
/** Outbound companion-pose broadcast rate (see docs/ar-pose-sync.md). */
const POSE_SEND_INTERVAL_MS = 100;
/** Slot spacing for the initial no-overlap placement (docs/ar-pose-sync.md item 5). */
const INITIAL_SLOT_SPACING = 0.9;

type FacingMode = "environment" | "user";

interface Props {
  /** Dismiss the overlay, returning to the Avatar hub. */
  onClose: () => void;
}

export function ARCameraScreen({ onClose }: Props) {
  const t = useT();
  const session = useSession();
  const hasSession = session !== null;
  const [profile] = useProfile();
  const members = useMembers();
  const vrmCids = useMemberVrmCids();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const arSceneRef = useRef<ArScene | null>(null);
  const companionRef = useRef<Companion | null>(null);
  const gestureRef = useRef<GestureHandle | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const remoteCompanionsRef = useRef<RemoteCompanionsManager | null>(null);
  /** VRM bytes read from storage before the scene exists yet; the scene-creation
   *  effect consumes this once it mounts. */
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

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [retryToken, setRetryToken] = useState(0);
  const [cameraError, setCameraError] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<{ url: string } | null>(null);

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

  // Fade the gesture hint after a few seconds.
  useEffect(() => {
    setShowHint(true);
    const id = window.setTimeout(() => setShowHint(false), 4000);
    return () => window.clearTimeout(id);
  }, []);

  // Revoke the previous save-to-device object URL whenever it's replaced or on unmount.
  useEffect(() => {
    return () => {
      if (lastShot) URL.revokeObjectURL(lastShot.url);
    };
  }, [lastShot]);

  // Acquire the camera stream on mount; re-runs on facing-mode flip or manual retry.
  useEffect(() => {
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
  }, [facingMode, retryToken]);

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

  // Set up the three.js overlay on mount, load any pending VRM, wire gestures.
  useEffect(() => {
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
  }, [swapCompanion, showToast, t]);

  // Read the stored VRM once on mount and adopt it (or leave the placeholder
  // golem if none is stored — the user reached this overlay deliberately).
  useEffect(() => {
    let cancelled = false;
    loadVrmBytes()
      .then((bytes) => {
        if (cancelled || !bytes) return;
        if (arSceneRef.current) {
          swapCompanion(() => loadVrmFromBytes(bytes).then(createVrmCompanion)).catch(() => {
            showToast(t("ar.summonError"));
          });
        } else {
          pendingVrmBytesRef.current = bytes;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [swapCompanion, showToast, t]);

  // Mirrors every other room member's companion onto the shared virtual stage
  // while in a room (group-photo mode) — see docs/ar-pose-sync.md. Gated on
  // hasSession (not the whole `session` object) so this doesn't tear down/
  // recreate on every unrelated doc change; arSceneRef.current is already set
  // because the scene-creation effect above runs first within the same commit.
  useEffect(() => {
    if (!hasSession) return;
    const arScene = arSceneRef.current;
    if (!arScene) return;
    const manager = createRemoteCompanions(arScene, profile.id);
    remoteCompanionsRef.current = manager;
    // Seed the roster/cids the effects below only re-push on change — a freshly
    // (re)created manager must not wait for the next change to learn the current
    // room state.
    manager.setMembers(liveContextRef.current.members.map((m) => m.id));
    manager.setVrmCids(vrmCidsRef.current);
    const unsubscribe = onCompanionPose((pose) => manager.applyPose(pose));
    return () => {
      unsubscribe();
      manager.dispose();
      remoteCompanionsRef.current = null;
    };
  }, [hasSession, profile.id]);

  useEffect(() => {
    remoteCompanionsRef.current?.setVrmCids(vrmCids);
  }, [vrmCids]);

  // Roster gate for the unauthenticated pose channel: only real members may
  // materialize as remote companions (see RemoteCompanionsManager.setMembers).
  useEffect(() => {
    remoteCompanionsRef.current?.setMembers(members.map((m) => m.id));
  }, [members]);

  // 10Hz outbound pose broadcast (docs/ar-pose-sync.md). sendCompanionPose
  // itself is a safe no-op outside a session, so this only needs to start/stop
  // with the overlay's lifetime.
  useEffect(() => {
    if (!hasSession) return;
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
  }, [hasSession]);

  // Late-arriving members still get a non-overlapping starting spot, as long as
  // the companion hasn't been moved yet.
  useEffect(() => {
    if (!hasSession) return;
    applyInitialCompanionOffset();
  }, [hasSession, members, profile.id]);

  function handleFlip(): void {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }

  function handleRetry(): void {
    setRetryToken((n) => n + 1);
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

      // Persist unconditionally: addPhotoAuto routes to the room's Y.Doc when in
      // a party, else to the local solo store — so a solo AR selfie with your
      // VRM companion is saved and shows up in the album and on the map, not
      // just as a throwaway preview.
      await addPhotoAuto(bytes, { caption: "", geo, width, height, arShot: true });
      showToast(t("ar.toastRecorded"));

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

  return (
    <div class="ar-screen ar-capture">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} class="ar-video" playsInline muted autoPlay />
      {cameraError && <div class="ar-stage-backdrop" />}
      <div ref={overlayRef} class="ar-overlay" />

      <div class={`ar-hint${showHint ? "" : " hidden"}`}>{t("ar.hint")}</div>

      <div class="ar-topbar">
        <button type="button" class="ar-icon-btn" onClick={onClose} aria-label={t("ar.close")}>
          <X size={20} />
        </button>
        <h1 class="ar-title">{t("ar.title")}</h1>
        <div class="ar-topbar-actions">
          <button type="button" class="ar-icon-btn" onClick={handleFlip} aria-label={t("ar.flipCamera")}>
            <SwitchCamera size={20} />
          </button>
        </div>
      </div>

      {toast && <div class="ar-toast">{toast}</div>}

      {lastShot && (
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
          <button type="button" class="ar-shutter" onClick={handleCapture} disabled={capturing} aria-label={t("ar.capture")}>
            <CameraIcon size={28} />
          </button>
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

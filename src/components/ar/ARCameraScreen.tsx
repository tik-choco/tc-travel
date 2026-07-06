// The "Summoning Circle": camera-video + transparent WebGL VRM overlay,
// composited into a group photo. No WebXR (iOS Safari lacks it).

import "./ar.i18n";
import "./ar.css";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  Camera as CameraIcon,
  Download,
  RotateCcw,
  RotateCw,
  SwitchCamera,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useSession, addPhoto } from "../../lib/store";
import { compressImage } from "../../lib/photo";
import { lookupCountry } from "../../lib/geo";
import type { GeoPoint } from "../../lib/types";
import type { Companion } from "./companion";
import { createArScene, type ArScene } from "./arScene";
import { createPlaceholderCompanion } from "./placeholderCompanion";
import { createVrmCompanion, loadVrmFromBytes } from "./vrmLoader";
import { attachGestures, rotateStep, zoomStep, type GestureHandle } from "./gestures";
import { loadVrmBytes, saveVrmBytes } from "./vrmStorage";

const ROTATE_STEP = Math.PI / 12;
const ZOOM_STEP_FACTOR = 1.15;

type FacingMode = "environment" | "user";

export function ARCameraScreen() {
  const t = useT();
  const session = useSession();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const arSceneRef = useRef<ArScene | null>(null);
  const companionRef = useRef<Companion | null>(null);
  const gestureRef = useRef<GestureHandle | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [retryToken, setRetryToken] = useState(0);
  const [cameraError, setCameraError] = useState(false);
  const [vrmLoading, setVrmLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<{ url: string } | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Fade the gesture hint after a few seconds.
  useEffect(() => {
    const id = window.setTimeout(() => setShowHint(false), 4000);
    return () => window.clearTimeout(id);
  }, []);

  // Revoke the previous save-to-device object URL whenever it's replaced or on unmount.
  useEffect(() => {
    return () => {
      if (lastShot) URL.revokeObjectURL(lastShot.url);
    };
  }, [lastShot]);

  // Acquire the camera stream; re-runs on facing-mode flip or manual retry.
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
    prev?.dispose();
  }, []);

  // Set up the three.js overlay once, load any stored VRM, wire gestures.
  useEffect(() => {
    const container = overlayRef.current;
    if (!container) return;

    const arScene = createArScene(container);
    arSceneRef.current = arScene;

    const placeholder = createPlaceholderCompanion();
    companionRef.current = placeholder;
    arScene.setCompanion(placeholder);

    const gestures = attachGestures(arScene.canvas, arScene.camera, () => companionRef.current?.root ?? null);
    gestureRef.current = gestures;

    loadVrmBytes()
      .then((bytes) => {
        if (!bytes) return;
        return swapCompanion(() => loadVrmFromBytes(bytes).then(createVrmCompanion));
      })
      .catch(() => {
        // Corrupt or unreadable stored VRM — keep the placeholder companion.
      });

    return () => {
      gestures.dispose();
      gestureRef.current = null;
      companionRef.current?.dispose();
      companionRef.current = null;
      arScene.dispose();
      arSceneRef.current = null;
    };
  }, [swapCompanion]);

  function handleFlip(): void {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }

  function handleRetry(): void {
    setRetryToken((n) => n + 1);
  }

  function handleLoadClick(): void {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    setVrmLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await swapCompanion(() => loadVrmFromBytes(bytes).then(createVrmCompanion));
      await saveVrmBytes(bytes).catch(() => undefined);
    } catch (err) {
      console.error(err);
      showToast(t("ar.summonError"));
    } finally {
      setVrmLoading(false);
    }
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
    if (!video || !arScene || capturing) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    setCapturing(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);

    try {
      // Crop the native video frame the same way `object-fit: cover` crops
      // it for display, so the capture matches what's on screen.
      const rect = video.getBoundingClientRect();
      const screenAspect = rect.width / rect.height;
      const videoW = video.videoWidth;
      const videoH = video.videoHeight;
      const videoAspect = videoW / videoH;

      let sx: number;
      let sy: number;
      let sw: number;
      let sh: number;
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

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D context unavailable");

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.drawImage(arScene.canvas, 0, 0, arScene.canvas.width, arScene.canvas.height, 0, 0, sw, sh);

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

  return (
    <div class="ar-screen">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} class="ar-video" playsInline muted autoPlay />
      <div ref={overlayRef} class="ar-overlay" />

      <div class={`ar-hint${showHint ? "" : " hidden"}`}>{t("ar.hint")}</div>

      <div class="ar-topbar">
        <h1 class="ar-title">{t("ar.title")}</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" class="ar-icon-btn" onClick={handleLoadClick} disabled={vrmLoading} aria-label={t("ar.summonBtn")}>
            <Upload size={20} />
          </button>
          <button type="button" class="ar-icon-btn" onClick={handleFlip} aria-label={t("ar.flipCamera")}>
            <SwitchCamera size={20} />
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".vrm" class="ar-file-input" onChange={handleFileChange} />

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
        <div class="ar-shutter-row">
          <button type="button" class="ar-shutter" onClick={handleCapture} disabled={capturing} aria-label={t("ar.capture")}>
            <CameraIcon size={28} />
          </button>
        </div>
      </div>

      <div class={`ar-flash${flash ? " active" : ""}`} />

      {cameraError && (
        <div class="ar-permission-panel">
          <div class="panel">
            <h2 class="title-ornate">{t("ar.permissionTitle")}</h2>
            <p>{t("error.cameraPermission")}</p>
            <button type="button" class="btn btn-primary" onClick={handleRetry}>
              {t("ar.retry")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

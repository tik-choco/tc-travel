// Avatar hub: your companion's home — NO getUserMedia, ever. A welcoming
// empty-state hero until a VRM is summoned (or the placeholder golem is
// entered), then a three.js stage over a warm, cozy backdrop where you can
// pose the companion, talk to it, adopt it as your profile portrait, and — via
// the hero "AR撮影" button — open the capture overlay to take a photo together.
//
// This screen reuses the ../ar/ scene + VRM + gesture modules across the folder
// boundary; only the camera/capture concerns live in ../ar/ARCameraScreen now.

import "./avatar.i18n";
import "./avatar.css";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  Box,
  Camera as CameraIcon,
  HardDrive,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  RotateCw,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-preact";
import { useT } from "../../lib/i18n";
import { setMemberVrmBytes } from "../../lib/store";
import { setProfileAvatar } from "../../lib/avatar";
import { listDriveFiles, loadDriveFileBytes, type DriveFileEntry } from "../../lib/drive/reader";
import { loadTownCharacters, subscribeTownCharacters, type CharacterIndexEntry } from "../../lib/town/characterIndex";
import { resolveTownVrmBytes } from "../../lib/town/vrmResolve";
import { townAppUrl } from "../../lib/town/townLink";
import { loadAiSettings, saveAiSettings } from "../../lib/ai/aiSettings";
import type { Companion } from "../ar/companion";
import { createArScene, type ArScene } from "../ar/arScene";
import { createPlaceholderCompanion } from "../ar/placeholderCompanion";
import { createVrmCompanion, loadVrmFromBytes } from "../ar/vrmLoader";
import { attachGestures, rotateStep, zoomStep, type GestureHandle } from "../ar/gestures";
import { loadVrmBytes, saveVrmBytes, clearVrmBytes } from "../ar/vrmStorage";
import { isAiConfigured } from "../../lib/ai/aiSettings";
import { getCompanionClient } from "../../lib/ai/companionClient";
import { CompanionTalkPanel } from "../ar/CompanionTalkPanel";
import { ARCameraLazy } from "../ar/ARCameraLazy";

const ROTATE_STEP = Math.PI / 12;
const ZOOM_STEP_FACTOR = 1.15;
const TOAST_DEFAULT_MS = 3200;
const TOAST_SHORT_MS = 2000;

/** "checking" = reading IndexedDB for a stored VRM; "empty" = the welcoming
 *  hero with no companion loaded yet; "stage" = the 3D room is mounted. */
type ScreenMode = "checking" | "empty" | "stage";

export function AvatarScreen() {
  const t = useT();

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const arSceneRef = useRef<ArScene | null>(null);
  const companionRef = useRef<Companion | null>(null);
  const gestureRef = useRef<GestureHandle | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  /** VRM bytes found in storage (or just picked) before the scene exists yet;
   *  the scene-creation effect consumes this once it mounts. */
  const pendingVrmBytesRef = useRef<Uint8Array | null>(null);

  const [mode, setMode] = useState<ScreenMode>("checking");
  const [hasVrm, setHasVrm] = useState(false);
  const [vrmLoading, setVrmLoading] = useState(false);
  /** Populated right before the sheet opens (handleLoadClick), from
   *  listDriveFiles — see the drive source picker below. */
  const [driveEntries, setDriveEntries] = useState<DriveFileEntry[]>([]);
  /** tc-town's published character roster (shared-bus "character-index"
   *  topic) — kept live via subscribeTownCharacters rather than only read at
   *  sheet-open time, so the chooser option appears/disappears as tc-town
   *  publishes without requiring a reload. */
  const [townEntries, setTownEntries] = useState<CharacterIndexEntry[]>([]);
  const [showVrmChooser, setShowVrmChooser] = useState(false);
  const [settingPortrait, setSettingPortrait] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showTalkPanel, setShowTalkPanel] = useState(false);
  /** When true, the capture overlay (../ar/ARCameraScreen) is mounted on top,
   *  covering the whole shell including the tab bar. */
  const [showCamera, setShowCamera] = useState(false);

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
  // it's only torn down when this whole hub unmounts, not when the talk panel
  // closes or the stage is recreated — see docs/ai-companion.md.
  useEffect(() => {
    return () => {
      getCompanionClient().disconnect();
    };
  }, []);

  // Fade the gesture hint after a few seconds.
  useEffect(() => {
    if (mode !== "stage") return;
    setShowHint(true);
    const id = window.setTimeout(() => setShowHint(false), 4000);
    return () => window.clearTimeout(id);
  }, [mode]);

  // Pause the hub's render loop while the capture overlay covers it — the
  // overlay is opaque and runs its own scene + camera, so keeping this one
  // drawing underneath is pure GPU/battery waste. The scene stays ALIVE (the
  // companion's transform is preserved); it resumes cleanly on close.
  useEffect(() => {
    arSceneRef.current?.setPaused(showCamera);
  }, [showCamera]);

  // tc-town's character roster: read once on mount, then stay live for as
  // long as this screen is mounted (tc-town may publish after we've already
  // loaded — e.g. the user just switched apps and set up a character there).
  useEffect(() => {
    setTownEntries(loadTownCharacters());
    return subscribeTownCharacters(setTownEntries);
  }, []);

  // Check for a previously-stored VRM once on mount. No bytes → land on the
  // empty-state hero instead of eagerly mounting the 3D stage.
  useEffect(() => {
    let cancelled = false;
    loadVrmBytes()
      .then((bytes) => {
        if (cancelled) return;
        if (bytes) {
          pendingVrmBytesRef.current = bytes;
          setHasVrm(true);
          setMode("stage");
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

  // Set up the three.js stage once live, load any pending VRM, wire gestures.
  useEffect(() => {
    if (mode !== "stage") return;
    const container = overlayRef.current;
    if (!container) return;

    const arScene = createArScene(container);
    arSceneRef.current = arScene;

    const placeholder = createPlaceholderCompanion();
    companionRef.current = placeholder;
    arScene.setCompanion(placeholder);

    const gestures = attachGestures(arScene.canvas, arScene.camera, () => companionRef.current?.root ?? null);
    gestureRef.current = gestures;

    const pending = pendingVrmBytesRef.current;
    pendingVrmBytesRef.current = null;
    if (pending) {
      swapCompanion(() => loadVrmFromBytes(pending).then(createVrmCompanion)).catch(() => {
        showToast(t("avatar.summonError"));
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

  // Adopts freshly-picked VRM bytes into the stage (or stashes them for the
  // scene-creation effect if it isn't mounted yet), persists them, and
  // publishes them to the room — shared by the device input and the drive
  // picker. setMemberVrmBytes keeps P2P group-photo semantics unchanged.
  const applyVrmBytes = useCallback(
    async (bytes: Uint8Array): Promise<void> => {
      if (mode === "stage" && arSceneRef.current) {
        await swapCompanion(() => loadVrmFromBytes(bytes).then(createVrmCompanion));
      } else {
        // Scene isn't mounted yet (coming from the empty-state hero) — stash
        // the bytes and the scene-creation effect will pick them up.
        pendingVrmBytesRef.current = bytes;
        setMode("stage");
      }
      await saveVrmBytes(bytes).catch(() => undefined);
      setHasVrm(true);
      setMemberVrmBytes(bytes).catch((err) => console.warn("tc-travel: failed to publish companion VRM", err));
    },
    [mode, swapCompanion],
  );

  // Both the empty-state hero button and the stage upload button land here.
  // Always opens the chooser sheet (device vs. drive vs. tc-town) rather than
  // skipping straight to the native file picker when drive/tc-town are empty:
  // the tc-town section always renders something now — either the character
  // list or the P0-4 cross-sell card pointing at tc-town's character
  // workshop — so it's never a dead end to show it.
  function handleLoadClick(): void {
    const entries = listDriveFiles({ extensions: [".vrm"] });
    setDriveEntries(entries);
    setShowVrmChooser(true);
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
      showToast(t("avatar.summonError"));
    } finally {
      setVrmLoading(false);
    }
  }

  // Picking a tc-town character always applies its persona (and voice, if
  // published) to the AI companion settings immediately — no save button, per
  // this app family's auto-apply convention. If the character also has a
  // resolvable VRM, that's swapped in too; persona-only characters (or ones
  // whose VRM bytes couldn't be resolved from either the shared library DB or
  // mist storage) just get the persona, with a toast clarifying which
  // happened.
  async function handleChooseTownEntry(entry: CharacterIndexEntry): Promise<void> {
    setShowVrmChooser(false);

    const current = loadAiSettings();
    saveAiSettings({
      ...current,
      persona: entry.personaPrompt,
      voice: entry.voiceName ?? entry.voiceModel ?? current.voice,
    });

    const hasVrmRef = Boolean(entry.vrmChecksum || entry.vrmCid);
    if (!hasVrmRef) {
      showToast(t("avatar.townCharacterApplied", { name: entry.name }));
      return;
    }

    setVrmLoading(true);
    try {
      const bytes = await resolveTownVrmBytes(entry);
      if (bytes) {
        await applyVrmBytes(bytes);
        showToast(t("avatar.townCharacterApplied", { name: entry.name }));
      } else {
        showToast(t("avatar.townVrmUnresolved"));
      }
    } catch (err) {
      console.error(err);
      showToast(t("avatar.townVrmUnresolved"));
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
      showToast(t("avatar.summonError"));
    } finally {
      setVrmLoading(false);
    }
  }

  async function handleRemoveVrm(): Promise<void> {
    await clearVrmBytes().catch(() => undefined);
    await swapCompanion(() => Promise.resolve(createPlaceholderCompanion()));
    setHasVrm(false);
    showToast(t("avatar.removed"));
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
      showToast(t("avatar.portraitSaved"), TOAST_SHORT_MS);
    } catch (err) {
      console.error(err);
      showToast(t("avatar.portraitError"), TOAST_SHORT_MS);
    } finally {
      setSettingPortrait(false);
    }
  }

  const fileInput = (
    <input ref={fileInputRef} type="file" accept=".vrm" class="avatar-file-input" onChange={handleFileChange} />
  );

  // "Device" vs. "Drive" vs. "tc-town" source picker — always available from
  // handleLoadClick; the drive section is simply empty when driveEntries is
  // empty, and the tc-town section falls back to the P0-4 cross-sell card
  // when townEntries is empty.
  const vrmChooserSheet = showVrmChooser && (
    <div
      class="modal-backdrop"
      onClick={() => setShowVrmChooser(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t("avatar.chooserTitle")}
    >
      <div class="modal-card" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="avatar-chooser-header">
          <p class="title-ornate">{t("avatar.chooserTitle")}</p>
          <button
            type="button"
            class="btn btn-icon"
            aria-label={t("avatar.chooserClose")}
            onClick={() => setShowVrmChooser(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div class="avatar-chooser-body">
          <button type="button" class="list-item" onClick={handleChooseFromDevice}>
            <Smartphone size={20} aria-hidden="true" />
            <span class="list-item-body">
              <span class="list-item-title">{t("avatar.chooserFromDevice")}</span>
            </span>
          </button>

          <p class="avatar-chooser-section-label">
            <HardDrive size={14} aria-hidden="true" />
            {t("avatar.chooserFromDrive")}
          </p>
          {driveEntries.map((entry) => {
            const sub = entry.path || t("avatar.chooserRootFolder");
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

          <p class="avatar-chooser-section-label">
            <Users size={14} aria-hidden="true" />
            {t("avatar.chooserFromTown")}
          </p>
          {townEntries.length > 0 ? (
            townEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                class="list-item"
                onClick={() => handleChooseTownEntry(entry)}
              >
                <span class="list-item-body">
                  <span class="list-item-title">{entry.name}</span>
                  <span class="list-item-sub">{entry.summary}</span>
                </span>
                {(entry.vrmChecksum || entry.vrmCid) && (
                  <span class="list-item-trailing" aria-label={t("avatar.chooserHasVrm")}>
                    <Box size={16} aria-hidden="true" />
                  </span>
                )}
              </button>
            ))
          ) : (
            // P0-4 cross-sell: the character-index receiving end is otherwise
            // silent when tc-town hasn't published anything yet — spell out
            // that this is where a tc-town character would show up, and offer
            // a direct hand-off (new tab; same-origin sibling subpath).
            <div class="avatar-town-empty">
              <p class="avatar-town-empty-hint">{t("avatar.townEmptyHint")}</p>
              <a
                class="btn btn-ghost btn-block avatar-town-empty-link"
                href={townAppUrl()}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Sparkles size={16} aria-hidden="true" />
                {t("avatar.townEmptyOpen")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // The capture overlay owns its own scene + camera; it renders fixed over the
  // entire shell (including the tab bar) until dismissed.
  const cameraOverlay = showCamera && <ARCameraLazy onClose={() => setShowCamera(false)} />;

  if (mode === "checking") {
    return (
      <div class="avatar-screen avatar-screen-loading">
        {fileInput}
        <LoaderCircle class="avatar-spin" size={28} />
      </div>
    );
  }

  if (mode === "empty") {
    return (
      <div class="avatar-screen avatar-screen-empty">
        {fileInput}
        {vrmChooserSheet}
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">
            <Sparkles />
          </span>
          <p class="empty-state-title">{t("avatar.emptyTitle")}</p>
          <p class="empty-state-hint">{t("avatar.emptyHint")}</p>
          <button type="button" class="btn btn-primary" onClick={() => setMode("stage")} disabled={vrmLoading}>
            <Sparkles size={18} />
            {t("avatar.meetCompanion")}
          </button>
          <button type="button" class="btn btn-ghost" onClick={handleLoadClick} disabled={vrmLoading}>
            {vrmLoading ? <LoaderCircle class="avatar-spin" size={18} /> : <Upload size={18} />}
            {t("avatar.bringYourOwn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="avatar-screen">
      {fileInput}
      {vrmChooserSheet}
      {cameraOverlay}
      {hasVrm && isAiConfigured() && (
        <CompanionTalkPanel
          open={showTalkPanel}
          onClose={() => setShowTalkPanel(false)}
          companionRef={companionRef}
        />
      )}

      <div class="avatar-stage-backdrop" />
      <div ref={overlayRef} class="avatar-overlay" />

      <div class={`avatar-hint${showHint ? "" : " hidden"}`}>{t("avatar.hint")}</div>

      <div class="avatar-topbar">
        <h1 class="avatar-title">{t("avatar.title")}</h1>
        <div class="avatar-topbar-actions">
          {hasVrm && isAiConfigured() && (
            <button
              type="button"
              class="avatar-icon-btn"
              onClick={() => setShowTalkPanel(true)}
              aria-label={t("avatar.talkOpen")}
            >
              <MessageCircle size={20} />
            </button>
          )}
        </div>
      </div>

      {toast && <div class="avatar-toast">{toast}</div>}
      {vrmLoading && <div class="avatar-toast">{t("avatar.summonLoading")}</div>}

      <div class="avatar-bottombar">
        <div class="avatar-framing-controls">
          <button type="button" class="avatar-icon-btn" onClick={() => handleRotate(-1)} aria-label={t("avatar.rotateLeft")}>
            <RotateCcw size={18} />
          </button>
          <button type="button" class="avatar-icon-btn" onClick={() => handleZoom(1 / ZOOM_STEP_FACTOR)} aria-label={t("avatar.moveCloser")}>
            <ZoomIn size={18} />
          </button>
          <button type="button" class="avatar-icon-btn" onClick={() => handleZoom(ZOOM_STEP_FACTOR)} aria-label={t("avatar.moveFarther")}>
            <ZoomOut size={18} />
          </button>
          <button type="button" class="avatar-icon-btn" onClick={() => handleRotate(1)} aria-label={t("avatar.rotateRight")}>
            <RotateCw size={18} />
          </button>
        </div>

        <div class="avatar-manage-row">
          <button
            type="button"
            class="avatar-icon-btn"
            onClick={handleLoadClick}
            disabled={vrmLoading}
            aria-label={hasVrm ? t("avatar.replaceVrm") : t("avatar.summonBtn")}
          >
            <Upload size={20} />
          </button>
          {hasVrm && (
            <button
              type="button"
              class="avatar-icon-btn"
              onClick={handleSetProfilePortrait}
              disabled={settingPortrait}
              aria-label={t("avatar.setPortrait")}
            >
              {settingPortrait ? <LoaderCircle class="avatar-spin" size={20} /> : <ImagePlus size={20} />}
            </button>
          )}
          {hasVrm && (
            <button type="button" class="avatar-icon-btn" onClick={handleRemoveVrm} aria-label={t("avatar.removeVrm")}>
              <Trash2 size={20} />
            </button>
          )}
        </div>

        <button type="button" class="avatar-cta" onClick={() => setShowCamera(true)} disabled={vrmLoading}>
          <span class="avatar-cta-icon" aria-hidden="true">
            <CameraIcon size={22} />
          </span>
          <span class="avatar-cta-label">
            <span class="avatar-cta-title">{t("avatar.openCamera")}</span>
            <span class="avatar-cta-sub">{t("avatar.openCameraSub")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}

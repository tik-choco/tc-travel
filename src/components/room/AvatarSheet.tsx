// Bottom sheet for managing the Home avatar identity: portrait photo, the 3D
// VRM companion, and whether the VRM greets you on Home. Deliberately
// self-sufficient — outside a room this is the only place a first-time user
// can set up their VRM (the AR tab needs a session). The VRM file is saved
// unvalidated; the Home stage parses it and falls back to the portrait on
// failure, which keeps three.js out of this sheet's bundle.

import { useRef, useState } from "preact/hooks";
import { Box, Eye, ImagePlus, Trash2, X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useProfile } from "../../lib/personal";
import { setProfileAvatar } from "../../lib/avatar";
import { setMemberVrmBytes } from "../../lib/store";
import { clearVrmBytes, saveVrmBytes } from "../ar/vrmStorage";
import { Avatar } from "../common/Avatar";

interface AvatarSheetProps {
  hasVrm: boolean;
  onClose: () => void;
  /** VRM bytes were saved or cleared — the caller re-reads storage. */
  onVrmChanged: () => void;
}

export function AvatarSheet({ hasVrm, onClose, onVrmChanged }: AvatarSheetProps) {
  const t = useT();
  const [profile, setProfile] = useProfile();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handlePhotoFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await setProfileAvatar(file);
    } catch (err) {
      console.error("tc-travel: setProfileAvatar failed", err);
    } finally {
      setBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleVrmFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await saveVrmBytes(bytes);
      onVrmChanged();
      // Publish to the current room too, if any (safe no-op outside rooms).
      void setMemberVrmBytes(bytes).catch((err) => console.error("tc-travel: publish VRM failed", err));
    } catch (err) {
      console.error("tc-travel: saving VRM failed", err);
    } finally {
      setBusy(false);
      if (vrmInputRef.current) vrmInputRef.current.value = "";
    }
  };

  const handleRemoveVrm = async () => {
    setBusy(true);
    try {
      await clearVrmBytes();
      onVrmChanged();
    } catch (err) {
      console.error("tc-travel: clearing VRM failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-card" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="sheet-header">
          <p class="title-ornate">{t("home.avatarManage")}</p>
          <button type="button" class="btn btn-icon" aria-label={t("qr.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div class="sheet-body">
          <div class="avatar-sheet-preview" aria-hidden="true">
            <Avatar self size="lg" />
          </div>

          <button
            type="button"
            class="avatar-sheet-option"
            disabled={busy}
            onClick={() => photoInputRef.current?.click()}
          >
            <span class="avatar-sheet-option-icon" aria-hidden="true">
              <ImagePlus />
            </span>
            <span class="avatar-sheet-option-label">{t("home.setPhoto")}</span>
          </button>

          <button
            type="button"
            class="avatar-sheet-option"
            disabled={busy}
            onClick={() => vrmInputRef.current?.click()}
          >
            <span class="avatar-sheet-option-icon" aria-hidden="true">
              <Box />
            </span>
            <span class="avatar-sheet-option-label">
              {t(hasVrm ? "home.replaceVrm" : "home.setVrm")}
              <span class="avatar-sheet-option-hint">{t("home.vrmHint")}</span>
            </span>
          </button>

          {hasVrm && (
            <>
              <label class="avatar-sheet-option avatar-sheet-toggle">
                <span class="avatar-sheet-option-icon" aria-hidden="true">
                  <Eye />
                </span>
                <span class="avatar-sheet-option-label">{t("home.showVrmOnHome")}</span>
                <input
                  type="checkbox"
                  checked={profile.showHomeVrm !== false}
                  onChange={(e) => setProfile({ showHomeVrm: (e.target as HTMLInputElement).checked })}
                />
              </label>
              <button
                type="button"
                class="avatar-sheet-option avatar-sheet-danger"
                disabled={busy}
                onClick={handleRemoveVrm}
              >
                <span class="avatar-sheet-option-icon" aria-hidden="true">
                  <Trash2 />
                </span>
                <span class="avatar-sheet-option-label">{t("home.removeVrm")}</span>
              </button>
            </>
          )}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            class="visually-hidden"
            onChange={handlePhotoFile}
            aria-label={t("home.setPhoto")}
          />
          <input
            ref={vrmInputRef}
            type="file"
            accept=".vrm"
            class="visually-hidden"
            onChange={handleVrmFile}
            aria-label={t("home.setVrm")}
          />
        </div>
      </div>
    </div>
  );
}

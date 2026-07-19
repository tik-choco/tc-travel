import { useEffect, useRef, useState } from "preact/hooks";
import { Compass, ImagePlus, Monitor, Moon, Sun, Trash2, Upload } from "lucide-preact";
import type { Language, Profile, ThemePref } from "../../lib/types";
import { LANGUAGES } from "../../lib/types";
import { LANGUAGE_LABELS, getLanguage, setLanguage, useT } from "../../lib/i18n";
import { useThemeSetting } from "../../lib/theme";
import { clearProfileAvatar, setProfileAvatar } from "../../lib/avatar";
import { setMemberVrmBytes } from "../../lib/store";
import { clearVrmBytes, loadVrmBytes, saveVrmBytes } from "../ar/vrmStorage";
import { Avatar } from "../common/Avatar";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { requestOnboarding } from "../../lib/onboarding";

interface SettingsSectionProps {
  profile: Profile;
  onProfileChange: (patch: Partial<Profile>) => void;
}

const AVATAR_OPTIONS = [
  "🧙", "🧙‍♀️", "🧝", "🧝‍♀️", "🦸", "🦹", "🧛", "🧟", "🐉", "🦉", "🦁", "🐺", "🧭", "⚔️", "🏹", "🛡️",
];

const COLOR_OPTIONS = [
  "#d99a2b", "#c34f45", "#2b6f9e", "#4a8c58", "#d9694f", "#2fa094", "#c07a3a", "#6b7280",
];

const THEME_OPTIONS: { value: ThemePref; Icon: typeof Sun }[] = [
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
  { value: "auto", Icon: Monitor },
];

/** Language / avatar image / emoji / color pickers at the bottom of the Guild screen. */
export function SettingsSection({ profile, onProfileChange }: SettingsSectionProps) {
  const t = useT();
  const current = getLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [themePref, setThemePref] = useThemeSetting();

  const handleAvatarFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    try {
      await setProfileAvatar(file);
    } finally {
      setAvatarBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Mirror of Home's AvatarSheet VRM management, for in-room discoverability.
  // hasVrm is a lagging snapshot of vrmStorage (the source of truth).
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const [vrmBusy, setVrmBusy] = useState(false);
  const [hasVrm, setHasVrm] = useState(false);
  useEffect(() => {
    let alive = true;
    loadVrmBytes()
      .then((bytes) => {
        if (alive) setHasVrm(bytes !== null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleVrmFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setVrmBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await saveVrmBytes(bytes);
      setHasVrm(true);
      // Publish to the current room so companions update live (no-op outside rooms).
      void setMemberVrmBytes(bytes).catch((err) => console.error("tc-travel: publish VRM failed", err));
    } catch (err) {
      console.error("tc-travel: saving VRM failed", err);
    } finally {
      setVrmBusy(false);
      if (vrmInputRef.current) vrmInputRef.current.value = "";
    }
  };

  const handleVrmRemove = async () => {
    setVrmBusy(true);
    try {
      await clearVrmBytes();
      setHasVrm(false);
    } catch (err) {
      console.error("tc-travel: clearing VRM failed", err);
    } finally {
      setVrmBusy(false);
    }
  };

  return (
    <section class="panel guild-settings">
      <h2 class="title-ornate guild-section-title">{t("settings.title")}</h2>

      <div class="field">
        <label for="settings-language">{t("settings.language")}</label>
        <select
          id="settings-language"
          class="input"
          value={current}
          onChange={(e) => {
            const lang = (e.target as HTMLSelectElement).value as Language;
            setLanguage(lang);
            onProfileChange({ language: lang });
          }}
        >
          {LANGUAGES.map((lang: Language) => (
            <option key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </option>
          ))}
        </select>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t("settings.theme")}</span>
        <div
          role="radiogroup"
          aria-label={t("settings.theme")}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          {THEME_OPTIONS.map(({ value, Icon }) => (
            <button
              type="button"
              key={value}
              role="radio"
              aria-checked={themePref === value}
              class={`chip ${themePref === value ? "is-selected" : ""}`}
              onClick={() => setThemePref(value)}
            >
              <Icon size={16} />
              <span class="chip-text">{t(`settings.theme.${value}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t("settings.avatarImage")}</span>
        <div class="settings-avatar-image-row">
          <Avatar self size="lg" />
          <div class="settings-avatar-image-actions">
            <button
              type="button"
              class="btn btn-outlined"
              disabled={avatarBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={16} /> {t("settings.changeAvatarImage")}
            </button>
            {profile.avatarImage && (
              <button type="button" class="btn btn-ghost" onClick={() => clearProfileAvatar()}>
                <Trash2 size={16} /> {t("settings.removeAvatarImage")}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            class="visually-hidden"
            onChange={handleAvatarFile}
            aria-label={t("settings.changeAvatarImage")}
          />
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t("settings.vrm")}</span>
        <div class="settings-avatar-image-actions">
          <button
            type="button"
            class="btn btn-outlined"
            disabled={vrmBusy}
            onClick={() => vrmInputRef.current?.click()}
          >
            <Upload size={16} /> {t(hasVrm ? "settings.vrmReplace" : "settings.vrmUpload")}
          </button>
          {hasVrm && (
            <button type="button" class="btn btn-ghost" disabled={vrmBusy} onClick={handleVrmRemove}>
              <Trash2 size={16} /> {t("settings.vrmRemove")}
            </button>
          )}
        </div>
        {hasVrm && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={profile.showHomeVrm !== false}
              onChange={(e) => onProfileChange({ showHomeVrm: (e.target as HTMLInputElement).checked })}
            />
            <span class="settings-label">{t("settings.vrmShowOnHome")}</span>
          </label>
        )}
        <input
          ref={vrmInputRef}
          type="file"
          accept=".vrm"
          class="visually-hidden"
          onChange={handleVrmFile}
          aria-label={t("settings.vrmUpload")}
        />
      </div>

      <div class="settings-row">
        <span class="settings-label">{t("settings.avatar")}</span>
        <div class="settings-avatar-grid">
          {AVATAR_OPTIONS.map((emoji) => (
            <button
              type="button"
              key={emoji}
              class={`settings-avatar-btn ${profile.avatarEmoji === emoji ? "settings-avatar-btn-active" : ""}`}
              onClick={() => onProfileChange({ avatarEmoji: emoji })}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t("settings.color")}</span>
        <div class="settings-color-grid">
          {COLOR_OPTIONS.map((color) => (
            <button
              type="button"
              key={color}
              class={`settings-swatch ${profile.color === color ? "settings-swatch-active" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => onProfileChange({ color })}
              aria-label={color}
            />
          ))}
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t("settings.onboardingHint")}</span>
        <button type="button" class="btn btn-outlined" onClick={requestOnboarding}>
          <Compass size={16} /> {t("settings.onboardingReplay")}
        </button>
      </div>

      <h2 class="title-ornate guild-section-title">{t("settings.ai.title")}</h2>
      <AiSettingsPanel />
    </section>
  );
}

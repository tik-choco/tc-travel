import { useRef, useState } from "preact/hooks";
import { ImagePlus, Trash2 } from "lucide-preact";
import type { Language, Profile } from "../../lib/types";
import { LANGUAGES } from "../../lib/types";
import { LANGUAGE_LABELS, getLanguage, setLanguage, useT } from "../../lib/i18n";
import { clearProfileAvatar, setProfileAvatar } from "../../lib/avatar";
import { Avatar } from "../common/Avatar";

interface SettingsSectionProps {
  profile: Profile;
  onProfileChange: (patch: Partial<Profile>) => void;
}

const AVATAR_OPTIONS = [
  "🧙", "🧙‍♀️", "🧝", "🧝‍♀️", "🦸", "🦹", "🧛", "🧟", "🐉", "🦉", "🦁", "🐺", "🧭", "⚔️", "🏹", "🛡️",
];

const COLOR_OPTIONS = [
  "#c9a227", "#8c2f28", "#2f5d8c", "#3f7d4a", "#6a3f8c", "#2f8c85", "#c9682f", "#7a7a7a",
];

/** Language / avatar image / emoji / color pickers at the bottom of the Guild screen. */
export function SettingsSection({ profile, onProfileChange }: SettingsSectionProps) {
  const t = useT();
  const current = getLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

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
    </section>
  );
}

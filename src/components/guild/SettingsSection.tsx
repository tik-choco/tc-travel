import type { Language, Profile } from "../../lib/types";
import { LANGUAGES } from "../../lib/types";
import { LANGUAGE_LABELS, getLanguage, setLanguage, useT } from "../../lib/i18n";

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

/** Language / avatar / color pickers at the bottom of the Guild screen, all patching useProfile. */
export function SettingsSection({ profile, onProfileChange }: SettingsSectionProps) {
  const t = useT();
  const current = getLanguage();

  return (
    <section class="panel guild-settings">
      <h2 class="title-ornate guild-section-title">{t("settings.title")}</h2>

      <div class="settings-row">
        <span class="settings-label">{t("settings.language")}</span>
        <div class="settings-language-list">
          {LANGUAGES.map((lang: Language) => (
            <button
              type="button"
              key={lang}
              class={`btn settings-lang-btn ${current === lang ? "settings-lang-btn-active" : ""}`}
              onClick={() => {
                setLanguage(lang);
                onProfileChange({ language: lang });
              }}
            >
              {LANGUAGE_LABELS[lang]}
            </button>
          ))}
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

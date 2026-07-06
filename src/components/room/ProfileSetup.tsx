import "./room.i18n";
import { useState } from "preact/hooks";
import { useT, LANGUAGE_LABELS, getLanguage, setLanguage } from "../../lib/i18n";
import { LANGUAGES, type Language } from "../../lib/types";
import { useProfile } from "../../lib/personal";

const EMOJI_CHOICES = [
  "🧙", "🧝", "🗡️", "🛡️", "🏹", "🐉", "🦄", "🔮",
  "🏰", "⚔️", "🌟", "🧭", "🦉", "🐺", "🔥", "🌙",
];

const COLOR_CHOICES = [
  "#c9a227", // gold
  "#8c2f28", // wax seal red
  "#3f6b3a", // forest green
  "#2c4a7c", // royal blue
  "#5b3a8c", // purple
  "#8a5a2b", // bronze
  "#2c7c74", // teal
  "#6b7280", // steel
];

export function ProfileSetup() {
  const t = useT();
  const [profile, patchProfile] = useProfile();
  const [name, setName] = useState(profile.name);
  const [avatarEmoji, setAvatarEmoji] = useState(profile.avatarEmoji || EMOJI_CHOICES[0]);
  const [color, setColor] = useState(profile.color || COLOR_CHOICES[0]);
  const [showError, setShowError] = useState(false);

  const handleSave = (e: Event) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setShowError(true);
      return;
    }
    patchProfile({ name: trimmed, avatarEmoji, color });
  };

  return (
    <div class="screen profile-setup">
      <form class="panel" onSubmit={handleSave}>
        <p class="title-ornate">{t("profile.title")}</p>

        <div class="field">
          <label for="profile-name">{t("profile.nameLabel")}</label>
          <input
            id="profile-name"
            class="input"
            type="text"
            maxLength={40}
            value={name}
            placeholder={t("profile.namePlaceholder")}
            onInput={(e) => {
              setShowError(false);
              setName((e.target as HTMLInputElement).value);
            }}
          />
          {showError && <span style={{ color: "var(--seal)" }}>{t("profile.nameRequired")}</span>}
        </div>

        <div class="field">
          <label>{t("profile.avatarLabel")}</label>
          <div class="emoji-grid">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                class={`chip${avatarEmoji === emoji ? " is-selected" : ""}`}
                aria-pressed={avatarEmoji === emoji}
                aria-label={emoji}
                onClick={() => setAvatarEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div class="field">
          <label>{t("profile.colorLabel")}</label>
          <div class="color-grid">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                class={`chip-color${color === c ? " is-selected" : ""}`}
                style={{ background: c }}
                aria-pressed={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div class="field">
          <label>{t("profile.languageLabel")}</label>
          <div class="language-grid">
            {LANGUAGES.map((lang: Language) => (
              <button
                key={lang}
                type="button"
                class={`chip${getLanguage() === lang ? " is-selected" : ""}`}
                aria-pressed={getLanguage() === lang}
                onClick={() => {
                  setLanguage(lang);
                  patchProfile({ language: lang });
                }}
              >
                {LANGUAGE_LABELS[lang]}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block">
          {t("profile.save")}
        </button>
      </form>
    </div>
  );
}

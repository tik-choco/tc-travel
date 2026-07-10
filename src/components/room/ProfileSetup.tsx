import "./room.i18n";
import { useRef, useState } from "preact/hooks";
import { Camera } from "lucide-preact";
import { useT, LANGUAGE_LABELS, getLanguage, setLanguage } from "../../lib/i18n";
import { LANGUAGES, type Language } from "../../lib/types";
import { useProfile } from "../../lib/personal";
import { setProfileAvatar } from "../../lib/avatar";
import { Avatar } from "../common/Avatar";

export const EMOJI_CHOICES = [
  "🧙", "🧝", "🗡️", "🛡️", "🏹", "🐉", "🦄", "🔮",
  "🏰", "⚔️", "🌟", "🧭", "🦉", "🐺", "🔥", "🌙",
];

const COLOR_CHOICES = [
  "#d99a2b", // amber
  "#c34f45", // red
  "#4a8c58", // forest green
  "#2b6f9e", // ocean blue
  "#d9694f", // coral
  "#c07a3a", // orange
  "#2fa094", // teal
  "#6b7280", // steel
];

export function ProfileSetup() {
  const t = useT();
  const [profile, patchProfile] = useProfile();
  const [name, setName] = useState(profile.name);
  const [avatarEmoji, setAvatarEmoji] = useState(profile.avatarEmoji || EMOJI_CHOICES[0]);
  const [color, setColor] = useState(profile.color || COLOR_CHOICES[0]);
  const [showError, setShowError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = (e: Event) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setShowError(true);
      return;
    }
    patchProfile({ name: trimmed, avatarEmoji, color });
  };

  const handleFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await setProfileAvatar(file);
    } catch (err) {
      console.error("tc-travel: setProfileAvatar failed", err);
    } finally {
      setUploading(false);
      input.value = "";
    }
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
          {showError && <span class="profile-field-error">{t("profile.nameRequired")}</span>}
        </div>

        <div class="field">
          <label>{t("profile.avatarLabel")}</label>
          <div class="profile-avatar-picker">
            <button
              type="button"
              class="profile-avatar-btn"
              aria-label={t("profile.uploadCta")}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar self size="xl" />
              <span class="profile-avatar-badge" aria-hidden="true">
                <Camera />
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              class="visually-hidden"
              onChange={handleFile}
            />
          </div>
          <p class="profile-avatar-hint">{t("profile.avatarHint")}</p>

          <p class="section-title">{t("profile.emojiFallbackLabel")}</p>
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

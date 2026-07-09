import { useState } from "preact/hooks";
import { Compass, UserRound, Sparkles, Check, X, Map, Images, BookOpen, IdCard, Shield } from "lucide-preact";
import { useT, LANGUAGE_LABELS, getLanguage, setLanguage } from "../../lib/i18n";
import { LANGUAGES, type Language } from "../../lib/types";
import { useProfile } from "../../lib/personal";
import { EMOJI_CHOICES } from "./ProfileSetup";
import "./onboarding.i18n";
import "./onboarding.css";

const STEP_COUNT = 4;

/** Same icons as TabBar.TAB_META, so the tour reads as a preview of the real
 *  tab bar rather than a separate set of illustrations. `home` is left out —
 *  it's the landing itself, not a feature to introduce. */
const TOUR_ITEMS: Array<{ key: string; Icon: typeof Map; titleKey: string; bodyKey: string }> = [
  { key: "map", Icon: Map, titleKey: "tab.short.map", bodyKey: "onboarding.tourMapBody" },
  { key: "diary", Icon: BookOpen, titleKey: "tab.short.diary", bodyKey: "onboarding.tourDiaryBody" },
  { key: "album", Icon: Images, titleKey: "tab.short.album", bodyKey: "onboarding.tourAlbumBody" },
  { key: "avatar", Icon: UserRound, titleKey: "tab.short.avatar", bodyKey: "onboarding.tourAvatarBody" },
  { key: "post", Icon: IdCard, titleKey: "tab.short.post", bodyKey: "onboarding.tourPostBody" },
  { key: "guild", Icon: Shield, titleKey: "tab.short.guild", bodyKey: "onboarding.tourGuildBody" },
];

/**
 * First-run wizard shown by app.tsx as a modal overlay: welcome -> profile ->
 * feature tour -> done. Every step is skippable via the close button, and
 * closing at any point counts as "done" (the flag is owned by the caller via
 * `onClose`) — the Guild settings screen can re-open it any time.
 */
export function Onboarding(props: { onClose: () => void; onStartJourney?: () => void }) {
  const t = useT();
  const [profile, patchProfile] = useProfile();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== profile.name) patchProfile({ name: trimmed });
  }

  function goNext() {
    if (step === 1) commitName();
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function handleFinish() {
    commitName();
    props.onClose();
    props.onStartJourney?.();
  }

  return (
    <div class="modal-backdrop">
      <div
        class="modal-card onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.welcomeTitle")}
      >
        <div class="sheet-handle" />
        <button
          type="button"
          class="btn btn-icon onboarding-close"
          aria-label={t("common.close")}
          onClick={props.onClose}
        >
          <X aria-hidden="true" />
        </button>

        <div class="onboarding-body">
          {step === 0 && (
            <>
              <div class="onboarding-hero">
                <span class="empty-state-icon">
                  <Compass size={32} aria-hidden="true" />
                </span>
              </div>
              <p class="onboarding-title">{t("onboarding.welcomeTitle")}</p>
              <p class="onboarding-text">{t("onboarding.welcomeBody1")}</p>
              <p class="onboarding-text">{t("onboarding.welcomeBody2")}</p>
            </>
          )}

          {step === 1 && (
            <>
              <div class="onboarding-step-head">
                <span class="empty-state-icon">
                  <UserRound size={22} aria-hidden="true" />
                </span>
                <p class="title-ornate">{t("onboarding.profileTitle")}</p>
              </div>
              <p class="onboarding-text">{t("onboarding.profileBody")}</p>

              <div class="field">
                <label for="onboarding-name">{t("profile.nameLabel")}</label>
                <input
                  id="onboarding-name"
                  class="input"
                  type="text"
                  maxLength={40}
                  value={name}
                  placeholder={t("profile.namePlaceholder")}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                />
              </div>

              <div class="field">
                <label>{t("profile.avatarLabel")}</label>
                <div class="emoji-grid">
                  {EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      class={`chip${profile.avatarEmoji === emoji ? " is-selected" : ""}`}
                      aria-pressed={profile.avatarEmoji === emoji}
                      aria-label={emoji}
                      onClick={() => patchProfile({ avatarEmoji: emoji })}
                    >
                      {emoji}
                    </button>
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
            </>
          )}

          {step === 2 && (
            <>
              <div class="onboarding-step-head">
                <span class="empty-state-icon">
                  <Sparkles size={22} aria-hidden="true" />
                </span>
                <p class="title-ornate">{t("onboarding.tourTitle")}</p>
              </div>
              <div class="onboarding-tour-list">
                {TOUR_ITEMS.map(({ key, Icon, titleKey, bodyKey }) => (
                  <div class="onboarding-tour-row" key={key}>
                    <span class="onboarding-tour-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <div class="onboarding-tour-text">
                      <p class="onboarding-tour-title">{t(titleKey)}</p>
                      <p class="onboarding-tour-desc">{t(bodyKey)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div class="onboarding-step-head">
                <span class="empty-state-icon">
                  <Check size={22} aria-hidden="true" />
                </span>
                <p class="title-ornate">{t("onboarding.doneTitle")}</p>
              </div>
              <p class="onboarding-text">{t("onboarding.doneBody", { name: name.trim() || profile.name })}</p>
              <p class="onboarding-text">{t("onboarding.doneHint")}</p>
            </>
          )}
        </div>

        <footer class="onboarding-footer">
          <div class="onboarding-dots" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} class={`onboarding-dot${i === step ? " is-active" : ""}`} />
            ))}
          </div>
          <div class="onboarding-footer-actions">
            {step > 0 && (
              <button type="button" class="btn btn-outlined" onClick={goBack}>
                {t("common.back")}
              </button>
            )}
            {step === 0 && (
              <button type="button" class="btn btn-primary" onClick={goNext}>
                {t("onboarding.begin")}
              </button>
            )}
            {step > 0 && step < STEP_COUNT - 1 && (
              <button type="button" class="btn btn-primary" onClick={goNext}>
                {t("onboarding.next")}
              </button>
            )}
            {step === STEP_COUNT - 1 && (
              <button type="button" class="btn btn-primary" onClick={handleFinish}>
                {t("profile.save")}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

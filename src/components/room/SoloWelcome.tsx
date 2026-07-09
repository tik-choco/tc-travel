// A warm, self-contained welcome for a traveller journeying alone. Mounted by
// the orchestrator for as long as no party has been joined (not just in the
// first empty instant) — going solo is a whole valid way to play, so this
// stays around as a standing invitation rather than flashing once and
// disappearing. Going solo should feel inviting, not lonely: a little trail
// of footsteps walks toward the compass (the app's identity glyph — the same
// one Avatar falls back to), and the copy frames one person as already a
// whole journey.
//
// Self-dismissible: closing it (✕) is a one-way decision, persisted in
// localStorage under the app's `tc-travel:` key prefix, so it never resurfaces
// for that install even if the traveller stays partyless forever.
import "./solo.i18n";
import "./solo.css";
import { useState } from "preact/hooks";
import { Footprints, X } from "lucide-preact";
import { useT } from "../../lib/i18n";

const DISMISSED_KEY = "tc-travel:soloWelcomeDismissed";

function loadDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // storage full / unavailable (private mode) — worst case the card just
    // reappears next time; nothing else depends on this persisting.
  }
}

export function SoloWelcome(props: {
  /** CTA the parent wires (e.g. open capture to record the first place).
   *  Omitted → the card renders as pure encouragement, no button. */
  onStart?: () => void;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(loadDismissed);

  if (dismissed) return null;

  function handleDismiss() {
    persistDismissed();
    setDismissed(true);
  }

  return (
    <section class="solo-welcome" aria-label={t("solo.welcomeTitle")}>
      <button
        type="button"
        class="solo-welcome-dismiss"
        aria-label={t("solo.welcomeDismiss")}
        onClick={handleDismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <div class="solo-welcome-scene" aria-hidden="true">
        <span class="solo-welcome-glow" />
        <span class="solo-welcome-step solo-welcome-step-1" />
        <span class="solo-welcome-step solo-welcome-step-2" />
        <span class="solo-welcome-step solo-welcome-step-3" />
        <span class="solo-welcome-compass">{"\u{1F9ED}"}</span>
      </div>
      <p class="solo-welcome-title">{t("solo.welcomeTitle")}</p>
      <p class="solo-welcome-body">{t("solo.welcomeBody")}</p>
      <p class="solo-welcome-hint">{t("solo.welcomeHint")}</p>
      {props.onStart && (
        <button type="button" class="btn btn-primary" onClick={props.onStart}>
          <Footprints size={18} aria-hidden="true" />
          {t("solo.welcomeCta")}
        </button>
      )}
    </section>
  );
}

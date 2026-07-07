// A warm, self-contained welcome for a traveller journeying alone with nothing
// recorded yet. Mounted by the orchestrator on an empty solo hub. Going solo
// should feel inviting, not lonely: a little trail of footsteps walks toward
// the compass (the app's identity glyph — the same one Avatar falls back to),
// and the copy frames one person as already a whole journey.
import "./solo.i18n";
import "./solo.css";
import { Footprints } from "lucide-preact";
import { useT } from "../../lib/i18n";

export function SoloWelcome(props: {
  /** CTA the parent wires (e.g. open capture to record the first place).
   *  Omitted → the card renders as pure encouragement, no button. */
  onStart?: () => void;
}) {
  const t = useT();
  return (
    <section class="solo-welcome" aria-label={t("solo.welcomeTitle")}>
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

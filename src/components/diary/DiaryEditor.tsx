import { useState } from "preact/hooks";
import { Check, LoaderCircle, X } from "lucide-preact";
import { addDiaryAuto, updateDiaryAuto, type SourcedDiaryEntry } from "../../lib/memories";
import { lookupCountry, countryName } from "../../lib/geo";
import { useSession } from "../../lib/store";
import { getLanguage, useT } from "../../lib/i18n";
import { MOODS, MOOD_EMOJI } from "./moodMeta";
import type { GeoPoint } from "../../lib/types";

interface DiaryEditorProps {
  /** null = creating a new entry; otherwise editing an existing one of the
   *  user's own. Carries its source (room / local) so the save routes home. */
  entry: SourcedDiaryEntry | null;
  onClose: () => void;
}

function getGeoOnce(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}

/** New entries can attach the current location; existing entries can't change
 * geo (updateDiaryAuto's patch type only covers title/text/mood), so editing
 * shows the already-attached location read-only instead of a toggle. */
export function DiaryEditor({ entry, onClose }: DiaryEditorProps) {
  const t = useT();
  const session = useSession();
  const [title, setTitle] = useState(entry?.title ?? "");
  const [text, setText] = useState(entry?.text ?? "");
  const [mood, setMood] = useState<string>(entry?.mood ?? MOODS[0]);
  const [attachLocation, setAttachLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !text.trim()) {
      setShowValidation(true);
      return;
    }
    setSaving(true);
    if (entry) {
      updateDiaryAuto(entry, { title: title.trim(), text: text.trim(), mood });
    } else {
      let geo: GeoPoint | null = null;
      if (attachLocation) {
        const pos = await getGeoOnce();
        if (pos) {
          const countryCode = await lookupCountry(pos.coords.latitude, pos.coords.longitude);
          geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, countryCode };
        } else {
          setLocationFailed(true);
        }
      }
      addDiaryAuto({ title: title.trim(), text: text.trim(), mood, geo });
    }
    setSaving(false);
    onClose();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-card diary-sheet">
        <div class="sheet-handle" />

        <div class="diary-editor-header">
          <span class="diary-header-titling">
            <h2 class="diary-editor-title">{entry ? t("diary.editorTitleEdit") : t("diary.editorTitleNew")}</h2>
            <span class="diary-scope-badge">{session ? t("diary.scopeParty") : t("diary.scopePrivate")}</span>
          </span>
          <button type="button" class="btn btn-icon" onClick={onClose} disabled={saving} aria-label={t("diary.cancel")}>
            <X size={18} />
          </button>
        </div>

        <input
          type="text"
          class="input"
          placeholder={t("diary.titlePlaceholder")}
          aria-label={t("diary.titlePlaceholder")}
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />

        <textarea
          class="input diary-text-input"
          placeholder={t("diary.textPlaceholder")}
          aria-label={t("diary.textPlaceholder")}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />

        <div class="field">
          <span class="settings-label">{t("diary.moodLabel")}</span>
          <div class="diary-mood-picker">
            {MOODS.map((m) => (
              <button
                type="button"
                key={m}
                class={`chip mood-chip${mood === m ? " is-selected" : ""}`}
                onClick={() => setMood(m)}
              >
                <span aria-hidden="true">{MOOD_EMOJI[m]}</span>
                <span class="chip-text">{t(`mood.${m}`)}</span>
              </button>
            ))}
          </div>
        </div>

        <div class="diary-location-row">
          {entry ? (
            entry.geo?.countryCode ? (
              <span>{t("diary.locationAttached", { place: countryName(entry.geo.countryCode, getLanguage()) })}</span>
            ) : (
              <span>{t("diary.locationLockedNote")}</span>
            )
          ) : (
            <div class="diary-location-toggle">
              <label class="diary-location-label">
                <input
                  type="checkbox"
                  checked={attachLocation}
                  onChange={(e) => setAttachLocation((e.target as HTMLInputElement).checked)}
                />
                {t("diary.attachLocation")}
              </label>
              <p class="diary-location-hint">{t("diary.attachLocationHint")}</p>
              {locationFailed && <p class="diary-location-hint diary-location-failed">{t("diary.locationFailed")}</p>}
            </div>
          )}
        </div>

        {showValidation && <p class="diary-validation">{t("diary.validationRequired")}</p>}

        <div class="diary-editor-actions">
          <button type="button" class="btn btn-outlined" onClick={onClose} disabled={saving}>
            {t("diary.cancel")}
          </button>
          <button type="button" class="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle class="spin" size={16} /> : <Check size={16} />}
            {saving ? t("diary.saving") : t("diary.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "preact/hooks";
import { Check, LoaderCircle, X } from "lucide-preact";
import { addDiaryEntry, updateDiaryEntry } from "../../lib/store";
import { lookupCountry, countryName } from "../../lib/geo";
import { getLanguage, useT } from "../../lib/i18n";
import type { DiaryEntry, GeoPoint } from "../../lib/types";

const MOODS = ["triumphant", "merry", "weary", "wistful", "inspired"] as const;
const MOOD_EMOJI: Record<string, string> = {
  triumphant: "🏆",
  merry: "🎉",
  weary: "😴",
  wistful: "🌙",
  inspired: "✨",
};

interface DiaryEditorProps {
  /** null = creating a new entry; otherwise editing an existing one of the user's own. */
  entry: DiaryEntry | null;
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
 * geo (updateDiaryEntry's patch type only covers title/text/mood), so editing
 * shows the already-attached location read-only instead of a toggle. */
export function DiaryEditor({ entry, onClose }: DiaryEditorProps) {
  const t = useT();
  const [title, setTitle] = useState(entry?.title ?? "");
  const [text, setText] = useState(entry?.text ?? "");
  const [mood, setMood] = useState<string>(entry?.mood ?? MOODS[0]);
  const [attachLocation, setAttachLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !text.trim()) {
      setShowValidation(true);
      return;
    }
    setSaving(true);
    if (entry) {
      updateDiaryEntry(entry.id, { title: title.trim(), text: text.trim(), mood });
    } else {
      let geo: GeoPoint | null = null;
      if (attachLocation) {
        const pos = await getGeoOnce();
        if (pos) {
          const countryCode = await lookupCountry(pos.coords.latitude, pos.coords.longitude);
          geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, countryCode };
        }
      }
      addDiaryEntry({ title: title.trim(), text: text.trim(), mood, geo });
    }
    setSaving(false);
    onClose();
  };

  return (
    <div class="diary-modal-backdrop" role="dialog" aria-modal="true">
      <div class="diary-modal panel">
        <h2 class="title-ornate">{entry ? t("diary.editorTitleEdit") : t("diary.editorTitleNew")}</h2>

        <div class="diary-field">
          <input
            type="text"
            class="diary-title-input"
            placeholder={t("diary.titlePlaceholder")}
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="diary-field">
          <textarea
            class="diary-text-input"
            placeholder={t("diary.textPlaceholder")}
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        <div class="diary-field">
          <span>{t("diary.moodLabel")}</span>
          <div class="diary-mood-picker">
            {MOODS.map((m) => (
              <button
                type="button"
                key={m}
                class={`diary-mood-btn${mood === m ? " is-selected" : ""}`}
                onClick={() => setMood(m)}
              >
                <span aria-hidden="true">{MOOD_EMOJI[m]}</span> {t(`mood.${m}`)}
              </button>
            ))}
          </div>
        </div>

        <div class="diary-field">
          {entry ? (
            entry.geo?.countryCode ? (
              <span class="diary-location-row">
                {t("diary.locationAttached", { place: countryName(entry.geo.countryCode, getLanguage()) })}
              </span>
            ) : (
              <span class="diary-location-row">{t("diary.locationLockedNote")}</span>
            )
          ) : (
            <label class="diary-location-row">
              <input
                type="checkbox"
                checked={attachLocation}
                onChange={(e) => setAttachLocation((e.target as HTMLInputElement).checked)}
              />
              {t("diary.attachLocation")}
            </label>
          )}
        </div>

        {showValidation && <span class="diary-validation">{t("diary.validationRequired")}</span>}

        <div class="diary-modal-actions">
          <button type="button" class="btn" onClick={onClose} disabled={saving}>
            <X size={16} /> {t("diary.cancel")}
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

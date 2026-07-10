import { useState } from "preact/hooks";
import { X, Trash2, Search, Waves, MapPin } from "lucide-preact";
import type { EncounterPin } from "../../lib/types";
import { getLanguage, useT } from "../../lib/i18n";
import { ChipInput } from "./ChipInput";
import "./map.i18n";

export type SheetTarget =
  | {
      mode: "new";
      lat: number;
      lng: number;
      countryCode: string;
      resolving: boolean;
      /** Set when this target came from LocationPicker — overrides the
       *  country/ocean label derived from countryCode so the sheet shows
       *  exactly what the traveller picked. */
      pickerLabel?: string;
    }
  | { mode: "view"; pin: EncounterPin };

interface EncounterSheetProps {
  target: SheetTarget;
  /** Pre-resolved display label for the tapped location (country name / ocean / locating...). */
  locationLabel: string;
  canSave: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSave: (data: { title: string; companions: string[]; note: string }) => void;
  onDelete: () => void;
  /** "new" mode only: opens LocationPicker so a mis-tap on open water (or any
   *  imprecise tap) can be corrected by searching for a place by name. */
  onPickLocation?: () => void;
}

/** Bottom sheet for recording a new encounter or viewing/deleting an existing pin. */
export function EncounterSheet({
  target,
  locationLabel,
  canSave,
  canDelete,
  onClose,
  onSave,
  onDelete,
  onPickLocation,
}: EncounterSheetProps) {
  const t = useT();
  const isView = target.mode === "view";
  // Ocean = lookupCountry's point-in-polygon found nothing: a near-miss tap
  // resolves to "" silently, so this is the only signal a mis-tap happened.
  const isOceanMiss = target.mode === "new" && !target.resolving && !target.countryCode && !target.pickerLabel;
  const [title, setTitle] = useState(isView ? target.pin.title : "");
  const [companions, setCompanions] = useState<string[]>(isView ? target.pin.companions : []);
  const [note, setNote] = useState(isView ? target.pin.note : "");
  // Deleting a pin is irreversible, so guard it with a two-tap confirm rather
  // than a jarring native window.confirm — the first tap arms, the second erases.
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-card map-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="map-sheet__inner">
          <div class="map-sheet__header">
            <h2 class="title-ornate">{isView ? t("map.sheet.viewTitle") : t("map.sheet.newTitle")}</h2>
            <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.sheet.cancel")}>
              <X size={20} />
            </button>
          </div>
          <p class={["map-sheet__location", isOceanMiss ? "map-sheet__location--ocean" : ""].filter(Boolean).join(" ")}>
            {isOceanMiss ? <Waves size={14} aria-hidden="true" /> : <MapPin size={14} aria-hidden="true" />}
            <span>{locationLabel}</span>
          </p>
          {isOceanMiss && onPickLocation && (
            <div class="map-sheet__ocean-hint">
              <p>{t("map.sheet.oceanHint")}</p>
              <button type="button" class="btn btn-tonal" onClick={onPickLocation}>
                <Search size={16} />
                {t("map.sheet.pickByName")}
              </button>
            </div>
          )}

          {isView ? (
            <div class="map-sheet__body">
              <h3 class="map-sheet__pin-title">{target.pin.title || t("map.sheet.untitled")}</h3>
              {target.pin.companions.length > 0 && (
                <div class="map-sheet__companion-chips">
                  {target.pin.companions.map((name) => (
                    <span class="map-companion-chip" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
              <p class="map-sheet__date">
                {new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(target.pin.at),
                )}
              </p>
              {target.pin.note && <p class="map-sheet__note">{target.pin.note}</p>}
              {canDelete && (
                <button
                  type="button"
                  class={`btn btn-danger map-sheet__delete${confirmDelete ? " is-confirming" : ""}`}
                  aria-live="polite"
                  onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
                >
                  <Trash2 size={16} />
                  {confirmDelete ? t("map.sheet.deleteConfirm") : t("map.sheet.delete")}
                </button>
              )}
            </div>
          ) : (
            <div class="map-sheet__body">
              <div class="field">
                <label>{t("map.sheet.titleLabel")}</label>
                <input
                  class="input"
                  type="text"
                  value={title}
                  maxLength={80}
                  placeholder={t("map.sheet.titlePlaceholder")}
                  onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="field">
                <label>{t("map.sheet.companionsLabel")}</label>
                <ChipInput values={companions} onChange={setCompanions} placeholder={t("map.sheet.companionsPlaceholder")} />
              </div>
              <div class="field">
                <label>{t("map.sheet.noteLabel")}</label>
                <textarea
                  class="input"
                  value={note}
                  rows={3}
                  maxLength={500}
                  placeholder={t("map.sheet.notePlaceholder")}
                  onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
                />
              </div>
              {canSave ? (
                <button
                  type="button"
                  class="btn btn-primary btn-block map-sheet__save"
                  disabled={target.resolving}
                  onClick={() => onSave({ title: title.trim(), companions, note: note.trim() })}
                >
                  {t("map.sheet.save")}
                </button>
              ) : (
                <p class="map-sheet__hint">{t("map.hint.joinRoom")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from "preact/hooks";
import { X, Trash2 } from "lucide-preact";
import type { EncounterPin } from "../../lib/types";
import { useT } from "../../lib/i18n";
import { ChipInput } from "./ChipInput";
import "./map.i18n";

export type SheetTarget =
  | { mode: "new"; lat: number; lng: number; countryCode: string; resolving: boolean }
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
}: EncounterSheetProps) {
  const t = useT();
  const isView = target.mode === "view";
  const [title, setTitle] = useState(isView ? target.pin.title : "");
  const [companions, setCompanions] = useState<string[]>(isView ? target.pin.companions : []);
  const [note, setNote] = useState(isView ? target.pin.note : "");

  return (
    <div class="map-sheet-backdrop" onClick={onClose}>
      <div class="map-sheet panel" onClick={(e) => e.stopPropagation()}>
        <div class="map-sheet__header">
          <h2 class="title-ornate">{isView ? t("map.sheet.viewTitle") : t("map.sheet.newTitle")}</h2>
          <button type="button" class="map-sheet__close" onClick={onClose} aria-label={t("map.sheet.cancel")}>
            <X size={20} />
          </button>
        </div>
        <p class="map-sheet__location">{locationLabel}</p>

        {isView ? (
          <div class="map-sheet__body">
            <h3 class="map-sheet__pin-title">{target.pin.title || t("map.sheet.untitled")}</h3>
            {target.pin.companions.length > 0 && (
              <p class="map-sheet__companions">{target.pin.companions.join(", ")}</p>
            )}
            <p class="map-sheet__date">
              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(target.pin.at),
              )}
            </p>
            {target.pin.note && <p class="map-sheet__note">{target.pin.note}</p>}
            {canDelete && (
              <button type="button" class="btn map-sheet__delete" onClick={onDelete}>
                <Trash2 size={16} />
                {t("map.sheet.delete")}
              </button>
            )}
          </div>
        ) : (
          <div class="map-sheet__body">
            <label class="map-sheet__field">
              <span>{t("map.sheet.titleLabel")}</span>
              <input
                type="text"
                value={title}
                maxLength={80}
                placeholder={t("map.sheet.titlePlaceholder")}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="map-sheet__field">
              <span>{t("map.sheet.companionsLabel")}</span>
              <ChipInput values={companions} onChange={setCompanions} placeholder={t("map.sheet.companionsPlaceholder")} />
            </label>
            <label class="map-sheet__field">
              <span>{t("map.sheet.noteLabel")}</span>
              <textarea
                value={note}
                rows={3}
                maxLength={500}
                placeholder={t("map.sheet.notePlaceholder")}
                onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
              />
            </label>
            {canSave ? (
              <button
                type="button"
                class="btn btn-primary map-sheet__save"
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
  );
}

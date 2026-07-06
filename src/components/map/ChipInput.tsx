import { useState } from "preact/hooks";
import { Plus, X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import "./map.i18n";

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

/** Type-a-name-and-add companion chip input, used in the encounter sheet. */
export function ChipInput({ values, onChange, placeholder }: ChipInputProps) {
  const t = useT();
  const [draft, setDraft] = useState("");

  const commit = () => {
    const name = draft.trim();
    if (name && !values.includes(name)) onChange([...values, name]);
    setDraft("");
  };

  return (
    <div class="map-chipinput">
      {values.length > 0 && (
        <div class="map-chipinput__chips">
          {values.map((name) => (
            <span class="map-chip" key={name}>
              {name}
              <button
                type="button"
                class="map-chip__remove"
                onClick={() => onChange(values.filter((v) => v !== name))}
                aria-label={t("map.sheet.companionsRemove", { name })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div class="map-chipinput__row">
        <input
          class="input"
          type="text"
          value={draft}
          placeholder={placeholder}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button
          type="button"
          class="btn btn-icon map-chipinput__add"
          onClick={commit}
          aria-label={t("map.sheet.companionsAdd")}
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

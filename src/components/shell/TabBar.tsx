import "./shell.i18n";
import { Map, Images, BookOpen, IdCard, UserRound, Shield } from "lucide-preact";
import { useT } from "../../lib/i18n";

// Tab id `camera` is kept for backward compat (see docs/REDESIGN.md) even
// though the tab is now framed as the "Avatar" hub, not a camera tool.
export type RoomTab = "map" | "album" | "diary" | "camera" | "post" | "guild";

// Short labels (tab.short.*): the long fantasy screen names (tab.*) overflow
// the fixed-width tab bar in European languages (e.g. de "Erinnerungsgrimoire").
const TABS: { id: RoomTab; icon: typeof Map; labelKey: string }[] = [
  { id: "map", icon: Map, labelKey: "tab.short.map" },
  { id: "album", icon: Images, labelKey: "tab.short.album" },
  { id: "diary", icon: BookOpen, labelKey: "tab.short.diary" },
  { id: "camera", icon: UserRound, labelKey: "tab.short.camera" },
  { id: "post", icon: IdCard, labelKey: "tab.short.post" },
  { id: "guild", icon: Shield, labelKey: "tab.short.guild" },
];

interface Props {
  active: RoomTab;
  onSelect: (tab: RoomTab) => void;
}

export function TabBar({ active, onSelect }: Props) {
  const t = useT();
  return (
    <nav class="tab-bar" aria-label={t("tab.nav")}>
      {TABS.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          type="button"
          class={`tab-bar-btn${active === id ? " is-active" : ""}`}
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <span class="tab-bar-indicator" aria-hidden="true">
            <Icon aria-hidden="true" />
          </span>
          <span class="tab-bar-label">{t(labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}

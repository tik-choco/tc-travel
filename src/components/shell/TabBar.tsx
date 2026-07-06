import "./shell.i18n";
import { Map, Images, BookOpen, Camera, Shield } from "lucide-preact";
import { useT } from "../../lib/i18n";

export type RoomTab = "map" | "album" | "diary" | "camera" | "guild";

const TABS: { id: RoomTab; icon: typeof Map; labelKey: string }[] = [
  { id: "map", icon: Map, labelKey: "tab.map" },
  { id: "album", icon: Images, labelKey: "tab.album" },
  { id: "diary", icon: BookOpen, labelKey: "tab.diary" },
  { id: "camera", icon: Camera, labelKey: "tab.camera" },
  { id: "guild", icon: Shield, labelKey: "tab.guild" },
];

interface Props {
  active: RoomTab;
  onSelect: (tab: RoomTab) => void;
}

export function TabBar({ active, onSelect }: Props) {
  const t = useT();
  return (
    <nav class="tab-bar" aria-label={t("tab.map")}>
      {TABS.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          type="button"
          class={`tab-bar-btn${active === id ? " is-active" : ""}`}
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <Icon aria-hidden="true" />
          <span class="tab-bar-label">{t(labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}

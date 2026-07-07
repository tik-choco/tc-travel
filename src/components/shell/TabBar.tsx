import "./shell.i18n";
import { House, Map, Images, BookOpen, IdCard, UserRound, Shield } from "lucide-preact";
import { useT } from "../../lib/i18n";

// Tab id `camera` is kept for backward compat (see docs/REDESIGN.md) even
// though the tab is now framed as the "Avatar" hub, not a camera tool.
// `home` is the solo landing (Quest Board); `post` (card exchange) only makes
// sense inside a party — the two exported sets below pick the right lineup per
// mode, and app.tsx renders whichever the current session state calls for.
export type RoomTab = "home" | "map" | "album" | "diary" | "camera" | "post" | "guild";

// Short labels (tab.short.*): the long fantasy screen names (tab.*) overflow
// the fixed-width tab bar in European languages (e.g. de "Erinnerungsgrimoire").
const TAB_META: Record<RoomTab, { icon: typeof Map; labelKey: string }> = {
  home: { icon: House, labelKey: "tab.short.home" },
  map: { icon: Map, labelKey: "tab.short.map" },
  album: { icon: Images, labelKey: "tab.short.album" },
  diary: { icon: BookOpen, labelKey: "tab.short.diary" },
  camera: { icon: UserRound, labelKey: "tab.short.camera" },
  post: { icon: IdCard, labelKey: "tab.short.post" },
  guild: { icon: Shield, labelKey: "tab.short.guild" },
};

/** Tab set inside a P2P room — encounters and cards are shared with the party,
 *  so `post` shows and the solo `home` landing is hidden. This is exactly the
 *  lineup that existed before solo mode, order unchanged. */
export const ROOM_TABS: readonly RoomTab[] = ["map", "album", "diary", "camera", "post", "guild"];

/** Tab set while travelling solo — `home` takes `post`'s place; every other
 *  screen works against the local-first store via the unified memories layer. */
export const SOLO_TABS: readonly RoomTab[] = ["home", "map", "album", "diary", "camera", "guild"];

interface Props {
  active: RoomTab;
  /** Which tabs to show — pass ROOM_TABS or SOLO_TABS (see app.tsx). */
  tabs: readonly RoomTab[];
  onSelect: (tab: RoomTab) => void;
}

export function TabBar({ active, tabs, onSelect }: Props) {
  const t = useT();
  return (
    <nav class="tab-bar" aria-label={t("tab.nav")}>
      {tabs.map((id) => {
        const { icon: Icon, labelKey } = TAB_META[id];
        return (
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
        );
      })}
    </nav>
  );
}

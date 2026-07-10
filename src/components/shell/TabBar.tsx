import "./shell.i18n";
import { House, Map, Images, BookOpen, IdCard, UserRound, Shield } from "lucide-preact";
import { useT } from "../../lib/i18n";

// The `avatar` tab is the companion's hub (../avatar/AvatarScreen); the AR
// capture experience is launched from inside it, not tabbed to directly.
// `home` is the solo landing (Quest Board); `post` (card exchange) is
// face-to-face QR only and works with no room at all, so it's on both
// lineups below — app.tsx renders whichever the current session state calls
// for. Tab state is useState-only (not persisted), so this rename is safe.
export type RoomTab = "home" | "map" | "album" | "diary" | "avatar" | "post" | "guild";

// Short labels (tab.short.*): the long fantasy screen names (tab.*) overflow
// the fixed-width tab bar in European languages (e.g. de "Erinnerungsgrimoire").
const TAB_META: Record<RoomTab, { icon: typeof Map; labelKey: string }> = {
  home: { icon: House, labelKey: "tab.short.home" },
  map: { icon: Map, labelKey: "tab.short.map" },
  album: { icon: Images, labelKey: "tab.short.album" },
  diary: { icon: BookOpen, labelKey: "tab.short.diary" },
  avatar: { icon: UserRound, labelKey: "tab.short.avatar" },
  post: { icon: IdCard, labelKey: "tab.short.post" },
  guild: { icon: Shield, labelKey: "tab.short.guild" },
};

/** Tab set inside a P2P room — the solo `home` landing is hidden since the
 *  room itself is the landing. Room landing stays `map`; `avatar` is
 *  promoted to second, next to it. */
export const ROOM_TABS: readonly RoomTab[] = ["map", "avatar", "album", "diary", "post", "guild"];

/** Tab set while travelling solo — `home` leads, and the high-priority
 *  `avatar`/`map`/`album` trio follows. `post` (card exchange) is local-only
 *  and room-independent, so it shows here too. Every screen works against
 *  the local-first store via the unified memories layer. */
export const SOLO_TABS: readonly RoomTab[] = ["home", "avatar", "map", "album", "diary", "post", "guild"];

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

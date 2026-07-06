import { BookText, Camera, Globe, MapPin, PartyPopper, Sparkles, Users } from "lucide-preact";
import type { ComponentType } from "preact";
import type { JourneyStats } from "../../lib/types";
import { useT } from "../../lib/i18n";

const TILES: { icon: ComponentType<{ size?: number | string }>; labelKey: string; value: (s: JourneyStats) => number }[] = [
  { icon: Globe, labelKey: "stats.countries", value: (s) => s.countriesVisited.length },
  { icon: Users, labelKey: "stats.companions", value: (s) => s.companionsMet.length },
  { icon: Camera, labelKey: "stats.photos", value: (s) => s.photoCount },
  { icon: Sparkles, labelKey: "stats.arPhotos", value: (s) => s.arPhotoCount },
  { icon: BookText, labelKey: "stats.diary", value: (s) => s.diaryCount },
  { icon: MapPin, labelKey: "stats.pins", value: (s) => s.pinCount },
  { icon: PartyPopper, labelKey: "stats.parties", value: (s) => s.roomCount },
];

/** MD3 stat tiles: countries, companions, photos, AR photos, diary entries, pins, parties. */
export function StatsGrid({ stats }: { stats: JourneyStats }) {
  const t = useT();
  return (
    <section class="panel guild-stats">
      <h2 class="title-ornate guild-section-title">{t("stats.title")}</h2>
      <div class="stats-grid">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <div class="stat-tile" key={tile.labelKey}>
              <Icon size={20} aria-hidden="true" />
              <span class="stat-tile-value">{tile.value(stats)}</span>
              <span class="stat-tile-label">{t(tile.labelKey)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

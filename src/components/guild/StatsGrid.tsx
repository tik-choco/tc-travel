import type { JourneyStats } from "../../lib/types";
import { useT } from "../../lib/i18n";

interface StatsGridProps {
  stats: JourneyStats;
}

const TILES: { icon: string; labelKey: string; value: (s: JourneyStats) => number }[] = [
  { icon: "🗺️", labelKey: "stats.countries", value: (s) => s.countriesVisited.length },
  { icon: "🤝", labelKey: "stats.companions", value: (s) => s.companionsMet.length },
  { icon: "📸", labelKey: "stats.photos", value: (s) => s.photoCount },
  { icon: "✨", labelKey: "stats.arPhotos", value: (s) => s.arPhotoCount },
  { icon: "📔", labelKey: "stats.diary", value: (s) => s.diaryCount },
  { icon: "📍", labelKey: "stats.pins", value: (s) => s.pinCount },
  { icon: "🎉", labelKey: "stats.parties", value: (s) => s.roomCount },
];

/** Small stat tiles: countries, companions, photos, AR photos, diary entries, pins, parties. */
export function StatsGrid({ stats }: StatsGridProps) {
  const t = useT();
  return (
    <section class="panel guild-stats">
      <h2 class="title-ornate guild-section-title">{t("stats.title")}</h2>
      <div class="stats-grid">
        {TILES.map((tile) => (
          <div class="stat-tile" key={tile.labelKey}>
            <span class="stat-tile-icon" aria-hidden="true">
              {tile.icon}
            </span>
            <span class="stat-tile-value">{tile.value(stats)}</span>
            <span class="stat-tile-label">{t(tile.labelKey)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

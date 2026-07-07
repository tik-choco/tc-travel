import "./guild.i18n";
import "./guild.css";
import { MapPin } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useProfile } from "../../lib/personal";
import { useJourneyStats } from "../../lib/journeyStats";
import { completionStats } from "../map/collection";
import { GuildCard } from "./GuildCard";
import { GuildChatLink } from "./GuildChatLink";
import { StatsGrid } from "./StatsGrid";
import { ExplorationPanel } from "./ExplorationPanel";
import { AchievementsGrid } from "./AchievementsGrid";
import { Chronicle } from "./Chronicle";
import { SettingsSection } from "./SettingsSection";

/** Guild Card screen: rank/XP/streak, stats, achievements, journey chronicle, settings.
 * Everything shown here is derived from the synced journey data — no separate
 * gamification state (see docs/DESIGN.md "Core retention loop"). Stats come from
 * the shared useJourneyStats() so cards met and prefectures filled count here
 * exactly as they do on Home and in the celebration layer. */
export function GuildScreen() {
  const t = useT();
  const [profile, updateProfile] = useProfile();
  const { stats, rank, prefectures } = useJourneyStats();
  const japan = prefectures.size > 0 ? completionStats(prefectures) : null;

  return (
    <div class="screen guild-screen">
      <h1 class="title-ornate guild-screen-title">{t("guild.title")}</h1>
      <GuildCard profile={profile} onProfileChange={updateProfile} rank={rank} streakDays={stats.streakDays} />
      <GuildChatLink />
      <StatsGrid stats={stats} />
      {japan && (
        <p class="guild-japan-line">
          <MapPin size={14} aria-hidden="true" />
          <span>{t("guild.japanCollection", { count: japan.count, total: japan.total, pct: japan.pct })}</span>
        </p>
      )}
      <ExplorationPanel />
      <AchievementsGrid stats={stats} />
      <Chronicle />
      <SettingsSection profile={profile} onProfileChange={updateProfile} />
    </div>
  );
}

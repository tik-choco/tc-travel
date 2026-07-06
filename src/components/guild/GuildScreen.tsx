import "./guild.i18n";
import "./guild.css";
import { useT } from "../../lib/i18n";
import { useJourney, useProfile } from "../../lib/personal";
import { computeRank, computeStats } from "../../lib/gamification";
import { GuildCard } from "./GuildCard";
import { StatsGrid } from "./StatsGrid";
import { AchievementsGrid } from "./AchievementsGrid";
import { Chronicle } from "./Chronicle";
import { SettingsSection } from "./SettingsSection";

/** Guild Card screen: rank/XP/streak, stats, achievements, journey chronicle, settings.
 * Everything shown here is derived from the synced journey data — no separate
 * gamification state (see docs/DESIGN.md "Core retention loop"). */
export function GuildScreen() {
  const t = useT();
  const [profile, updateProfile] = useProfile();
  const journey = useJourney();
  const stats = computeStats(journey);
  const rank = computeRank(stats);

  return (
    <div class="screen guild-screen">
      <h1 class="title-ornate guild-screen-title">{t("guild.title")}</h1>
      <GuildCard profile={profile} onProfileChange={updateProfile} rank={rank} streakDays={stats.streakDays} />
      <StatsGrid stats={stats} />
      <AchievementsGrid stats={stats} />
      <Chronicle />
      <SettingsSection profile={profile} onProfileChange={updateProfile} />
    </div>
  );
}

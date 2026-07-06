import { useState } from "preact/hooks";
import type { Profile, RankInfo } from "../../lib/types";
import { useT } from "../../lib/i18n";
import { tWithFallback } from "./fallback";

interface GuildCardProps {
  profile: Profile;
  onProfileChange: (patch: Partial<Profile>) => void;
  rank: RankInfo;
  streakDays: number;
}

/** The collectible "license card" at the top of the Guild screen: avatar medallion,
 * editable name, rank title, level badge, XP bar, and streak flame. */
export function GuildCard({ profile, onProfileChange, rank, streakDays }: GuildCardProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);

  const commit = () => {
    const name = draft.trim();
    if (name) onProfileChange({ name });
    setDraft(name || profile.name);
    setEditing(false);
  };

  const xpPct =
    rank.xpForNextLevel > 0 ? Math.min(100, Math.round((rank.xpIntoLevel / rank.xpForNextLevel) * 100)) : 100;
  const rankFallbackId = rank.titleKey.split(".").pop() ?? rank.titleKey;

  return (
    <section class="panel guild-card">
      <div class="guild-card-top">
        <div class="guild-medallion" aria-hidden="true">
          <span class="guild-medallion-emoji">{profile.avatarEmoji}</span>
        </div>
        <div class="guild-identity">
          {editing ? (
            <input
              class="guild-name-input"
              value={draft}
              placeholder={t("guild.namePlaceholder")}
              autoFocus
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(profile.name);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              class="guild-name-button"
              onClick={() => {
                setDraft(profile.name);
                setEditing(true);
              }}
              aria-label={t("guild.editName")}
            >
              <span class="guild-name">{profile.name}</span>
              <span class="guild-name-pencil" aria-hidden="true">
                ✎
              </span>
            </button>
          )}
          <div class="guild-rank-title">{tWithFallback(t, rank.titleKey, rankFallbackId)}</div>
          <div class="guild-level-badge">{t("guild.level", { level: rank.level })}</div>
        </div>
      </div>

      <div class="guild-xp-track" role="progressbar" aria-valuenow={xpPct} aria-valuemin={0} aria-valuemax={100}>
        <div class="guild-xp-fill" style={{ width: `${xpPct}%` }} />
      </div>
      <div class="guild-xp-label">
        {t("guild.xp", { xpIntoLevel: rank.xpIntoLevel, xpForNextLevel: rank.xpForNextLevel })}
      </div>

      <div class="guild-streak">
        <span class="guild-streak-flame" aria-hidden="true">
          🔥
        </span>
        <span>{streakDays > 0 ? t("guild.streak", { days: streakDays }) : t("guild.streakStart")}</span>
      </div>
    </section>
  );
}

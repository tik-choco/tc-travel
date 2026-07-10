import { useState } from "preact/hooks";
import { Flame, IdCard, Pencil } from "lucide-preact";
import { Avatar } from "../common/Avatar";
import { CardExchange } from "../post/CardExchange";
import type { Profile, RankInfo } from "../../lib/types";
import { useT } from "../../lib/i18n";
import { tWithFallback } from "./fallback";

interface GuildCardProps {
  profile: Profile;
  onProfileChange: (patch: Partial<Profile>) => void;
  rank: RankInfo;
  streakDays: number;
}

/** The Guild Card header: large centered self-portrait, editable name, rank
 * title + level, and an XP progress bar. */
export function GuildCard({ profile, onProfileChange, rank, streakDays }: GuildCardProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);
  const [cardOpen, setCardOpen] = useState(false);

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
    <>
      <section class="panel guild-card">
        <div class="guild-card-top">
          <Avatar self size="xl" />
          <button
            type="button"
            class="btn btn-icon btn-outlined"
            aria-label={t("post.exchangeTitle")}
            onClick={() => setCardOpen(true)}
          >
            <IdCard aria-hidden="true" />
          </button>

          {editing ? (
            <input
              class="input guild-name-input"
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
              <Pencil size={14} class="guild-name-pencil" aria-hidden="true" />
            </button>
          )}

          <div class="guild-rank-title">{tWithFallback(t, rank.titleKey, rankFallbackId)}</div>
          <span class="chip guild-level-badge">{t("guild.level", { level: rank.level })}</span>
        </div>

        <div class="guild-xp-track" role="progressbar" aria-valuenow={xpPct} aria-valuemin={0} aria-valuemax={100}>
          <div class="guild-xp-fill gold-shimmer" style={{ width: `${xpPct}%` }} />
        </div>
        <div class="guild-xp-label">
          {t("guild.xp", { xpIntoLevel: rank.xpIntoLevel, xpForNextLevel: rank.xpForNextLevel })}
        </div>

        <div class="guild-streak">
          <Flame size={16} aria-hidden="true" />
          <span>{streakDays > 0 ? t("guild.streak", { days: streakDays }) : t("guild.streakStart")}</span>
        </div>
      </section>

      {cardOpen && <CardExchange onClose={() => setCardOpen(false)} />}
    </>
  );
}

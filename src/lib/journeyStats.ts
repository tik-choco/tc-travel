// The one place derived journey stats are assembled, so Guild, Home and the
// CelebrationHost can never show different numbers. Folds three local sources
// into a single JourneyStats/RankInfo:
//   - the cross-room journey mirror (personal.ts)      — pins/photos/diary/streak/rooms
//   - the face-to-face card collection (cards.ts)      — real-world meetings
//   - the Japan prefecture drill-down (japanGeo.ts)    — collection depth
//
// The prefecture geometry is ~300KB and loads lazily, so it's only pulled in for
// travellers who've actually been to Japan (a cheap synchronous check on the
// journey mirror) — everyone else pays nothing and reports 0 prefectures.
import { useCards } from "./cards";
import { computeRank, computeStats } from "./gamification";
import { useUnifiedJourney } from "./memories";
import { useJapanCollection } from "../components/map/japanGeo";
import type { JourneyStats, RankInfo } from "./types";

export interface JourneyStatsResult {
  stats: JourneyStats;
  rank: RankInfo;
  /** distinct visited JP prefecture codes (empty until the geometry resolves) */
  prefectures: Set<string>;
  /** false only while Japan geometry is still loading for a Japan traveller —
   *  the CelebrationHost waits on this so prefecture credit can't arrive late
   *  and fire a false "unlocked" burst. */
  japanSettled: boolean;
}

function hasJapanPresence(journey: ReturnType<typeof useUnifiedJourney>): boolean {
  if (journey.pins.some((p) => p.countryCode === "jp")) return true;
  if (journey.photos.some((p) => p.geo?.countryCode === "jp")) return true;
  if (journey.diary.some((d) => d.geo?.countryCode === "jp")) return true;
  return false;
}

export function useJourneyStats(): JourneyStatsResult {
  const journey = useUnifiedJourney();
  const cards = useCards();
  const hasJapan = hasJapanPresence(journey);
  const { prefs, visited } = useJapanCollection(hasJapan);

  const stats = computeStats({
    ...journey,
    cardsCollected: cards.length,
    prefecturesVisited: visited.size,
  });
  const rank = computeRank(stats);
  const japanSettled = !hasJapan || prefs !== null;
  return { stats, rank, prefectures: visited, japanSettled };
}

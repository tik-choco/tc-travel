// Progressive "unlocks" — cosmetic/depth rewards layered on top of the
// always-available surfaces, NOT gates in front of them. Like gamification.ts,
// every unlock is a pure function of a JourneyStats snapshot, so an unlock can
// never desync from the underlying data and there is no stored flag to corrupt.
//
// Each unlock is TIERED: `have(stats)` reads a tracked signal and the highest
// tier whose `need` it meets is the current tier (0 = nothing unlocked yet).
// The tier number is what the CelebrationHost diffs against its ledger and what
// the UI reads to decide what's selectable/how much chrome to show.
import { useMemo } from "preact/hooks";
import { ACHIEVEMENTS } from "./gamification";
import { useJourneyStats } from "./journeyStats";
import type { JourneyStats } from "./types";

export interface UnlockTier {
  /** 1-based tier index (0 is the implicit "nothing yet" state). */
  tier: number;
  /** threshold on the unlock's tracked signal to reach this tier. */
  need: number;
  /** i18n key for the warm celebration line shown when this tier is crossed. */
  celebrateKey: string;
  /** i18n key for the anticipatory "you're getting close" whisper shown on Home
   *  BEFORE this tier fires (see nextUnlock). A gentle full sentence, a function
   *  of {remaining} — deliberately NOT the celebration copy (that's the payoff,
   *  this is the wondering-before). */
  upcomingKey: string;
}

export interface UnlockDef {
  id: string;
  icon: string;
  /** the tracked signal this unlock advances on. */
  have: (s: JourneyStats) => number;
  /** tiers in ascending `need` order. */
  tiers: UnlockTier[];
}

// Reuse the EXACT firstSteps signal (first pin/photo/diary entry) so the
// companion wakes on the very same touch that earns the firstSteps achievement —
// one shared "your journey has begun" moment, never two definitions to drift.
const firstStepsDef = ACHIEVEMENTS.find((a) => a.id === "firstSteps")!;

export const UNLOCKS: UnlockDef[] = [
  {
    id: "companionWake",
    icon: "✨",
    have: (s) => (firstStepsDef.achieved(s) ? 1 : 0),
    tiers: [{ tier: 1, need: 1, celebrateKey: "unlock.companionWake", upcomingKey: "unlock.upcoming.companionWake" }],
  },
  {
    id: "lensFilters",
    icon: "\u{1F305}",
    have: (s) => s.photoCount,
    tiers: [
      { tier: 1, need: 10, celebrateKey: "unlock.lens.golden", upcomingKey: "unlock.upcoming.golden" },
      { tier: 2, need: 25, celebrateKey: "unlock.lens.film", upcomingKey: "unlock.upcoming.film" },
      { tier: 3, need: 50, celebrateKey: "unlock.lens.lantern", upcomingKey: "unlock.upcoming.lantern" },
    ],
  },
  {
    id: "cardMotifs",
    icon: "\u{1F3B4}",
    have: (s) => s.cardsCollected,
    tiers: [
      { tier: 1, need: 1, celebrateKey: "unlock.card.first", upcomingKey: "unlock.upcoming.cardFirst" },
      { tier: 2, need: 10, celebrateKey: "unlock.card.gold", upcomingKey: "unlock.upcoming.cardGold" },
    ],
  },
];

/** The current tier of a single unlock (0 when none of its tiers are met). */
export function unlockedTier(def: UnlockDef, stats: JourneyStats): number {
  const have = def.have(stats);
  let tier = 0;
  for (const t of def.tiers) if (have >= t.need) tier = t.tier;
  return tier;
}

/** Every unlock's current tier as an id -> tier map, for celebration-diffing. */
export function unlockTiers(stats: JourneyStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of UNLOCKS) out[def.id] = unlockedTier(def, stats);
  return out;
}

/** Look up the tier metadata for a given unlock id + tier number (for copy). */
export function tierDef(id: string, tier: number): UnlockTier | undefined {
  return UNLOCKS.find((u) => u.id === id)?.tiers.find((t) => t.tier === tier);
}

export interface NextUnlock {
  def: UnlockDef;
  /** the next tier not yet reached (for its name/copy). */
  tier: UnlockTier;
  have: number;
  need: number;
  remaining: number;
}

function toNextUnlock(def: UnlockDef, stats: JourneyStats): NextUnlock | null {
  const have = def.have(stats);
  const tier = def.tiers.find((t) => have < t.need);
  if (!tier) return null;
  return { def, tier, have, need: tier.need, remaining: tier.need - have };
}

/** The nearest not-yet-reached unlock tier, for a warm anticipation whisper on
 *  Home. Mirrors gamification.ts's nextGoal(). Returns null once every unlock is
 *  maxed out.
 *
 *  companionWake is special-cased: it's the very first-session unlock and it's
 *  binary (a memory either exists or it doesn't), so its "distance" of 1 is NOT
 *  a meaningful number to compare against photoCount/cardsCollected distances
 *  (different units — "3 photos away" vs "make your first memory" aren't the
 *  same kind of 1). So whenever the companion is still asleep we surface IT,
 *  prioritized; only once it has woken do we fall back to whichever numeric
 *  unlock has the smallest remaining count. */
export function nextUnlock(stats: JourneyStats): NextUnlock | null {
  const companion = UNLOCKS.find((u) => u.id === "companionWake")!;
  const companionNext = toNextUnlock(companion, stats);
  if (companionNext) return companionNext;

  let best: NextUnlock | null = null;
  for (const def of UNLOCKS) {
    if (def.id === "companionWake") continue;
    const candidate = toNextUnlock(def, stats);
    if (candidate && (!best || candidate.remaining < best.remaining)) best = candidate;
  }
  return best;
}

export interface UnlocksState {
  /** id -> current tier map (source for both UI gating and celebration diffs). */
  tiers: Record<string, number>;
  /** the companion has woken (firstSteps met). */
  companionWake: boolean;
  /** highest lens-filter tier unlocked (0..3). */
  lensTier: number;
  /** highest card-motif tier unlocked (0..2). */
  cardTier: number;
}

/** Live unlock state derived from the shared journey stats. */
export function useUnlocks(): UnlocksState {
  const { stats } = useJourneyStats();
  return useMemo(() => {
    const tiers = unlockTiers(stats);
    return {
      tiers,
      companionWake: tiers.companionWake >= 1,
      lensTier: tiers.lensFilters,
      cardTier: tiers.cardMotifs,
    };
  }, [stats]);
}

// --- Lens filters -----------------------------------------------------------
// The filter catalogue is plain data (an id, the tier that unlocks it, and a CSS
// filter string) so the same string drives BOTH the live preview and the baked
// capture — see ARCameraScreen. Warm, evocative naming; each is a light/tone
// grade only (no asset pipeline). Labels are localized via ar.i18n.ts.

export interface LensFilterSpec {
  id: string;
  /** lensFilters tier that unlocks it (0 = always available). */
  tier: number;
  /** CSS filter string; "" means no filter. */
  css: string;
  labelKey: string;
}

export const LENS_FILTERS: LensFilterSpec[] = [
  { id: "none", tier: 0, css: "", labelKey: "ar.filter.none" },
  {
    id: "golden",
    tier: 1,
    css: "sepia(0.28) saturate(1.45) brightness(1.05) contrast(1.02)",
    labelKey: "ar.filter.golden",
  },
  {
    id: "film",
    tier: 2,
    css: "contrast(1.12) saturate(0.85) sepia(0.14) brightness(1.02)",
    labelKey: "ar.filter.film",
  },
  {
    id: "lantern",
    tier: 3,
    css: "sepia(0.22) saturate(1.3) hue-rotate(-12deg) brightness(0.97) contrast(1.06)",
    labelKey: "ar.filter.lantern",
  },
];

/** The filters selectable at a given lens tier (tier 0 always includes "none"). */
export function availableLensFilters(lensTier: number): LensFilterSpec[] {
  return LENS_FILTERS.filter((f) => f.tier <= lensTier);
}

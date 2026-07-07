// Shared data contracts for tc-travel. Owned by the orchestrator — implementation
// agents may add NEW types in their own modules but must not change these shapes.

/** Languages shipped at launch. `en` is the fallback. */
export type Language = "en" | "ja" | "zh" | "ko" | "es" | "fr" | "de" | "pt";
export const LANGUAGES: readonly Language[] = ["en", "ja", "zh", "ko", "es", "fr", "de", "pt"];

/** A participant in a room. Stored in the room Y.Doc under `members` (Y.Map keyed by id). */
export interface Member {
  id: string; // stable per-device uuid (same as profile.id)
  name: string;
  color: string; // css color used for pins/awareness
  avatarEmoji: string;
  /** mist storage cid of a small square JPEG avatar portrait; fallback is avatarEmoji */
  avatarCid?: string;
  /** mist storage cid of the AR companion VRM; "" is the just-cleared sentinel (same convention as avatarCid) */
  vrmCid?: string;
  joinedAt: number; // epoch ms
}

export interface GeoPoint {
  lat: number;
  lng: number;
  /** ISO 3166-1 alpha-2 lowercase, resolved via geo.ts point-in-polygon; "" if unresolved */
  countryCode: string;
}

/** Photo metadata stored in the room Y.Doc (`photos` Y.Array). Bytes live in mist storage. */
export interface Photo {
  id: string;
  cid: string; // mistlib storage cid for the JPEG bytes
  by: string; // member id
  at: number; // epoch ms
  caption: string;
  geo: GeoPoint | null;
  width: number;
  height: number;
  /** true when the photo was taken with the AR VRM camera */
  arShot: boolean;
}

/** Diary entry stored in the room Y.Doc (`diary` Y.Array). */
export interface DiaryEntry {
  id: string;
  by: string;
  at: number;
  title: string;
  text: string;
  /** one of a small fixed set of fantasy moods, e.g. "triumphant" | "merry" | "weary" | "wistful" | "inspired" */
  mood: string;
  geo: GeoPoint | null;
}

/** An encounter pin on the world map (`pins` Y.Array). The unit of map exploration. */
export interface EncounterPin {
  id: string;
  by: string;
  at: number;
  lat: number;
  lng: number;
  countryCode: string; // ISO 3166-1 alpha-2 lowercase — reveals this country's fog
  title: string;
  /** display names of the people met */
  companions: string[];
  note: string;
}

/** A message card swapped FACE-TO-FACE via QR — like exchanging business cards.
 *  You can only receive one by physically scanning the other person's screen,
 *  so a card is proof you met that person in the real world. The whole card
 *  travels inside the QR (see lib/cardQr.ts); received cards are kept locally as
 *  a keepsake collection (lib/cards.ts), independent of any room. */
export interface Card {
  /** the sender's stable profile id — also the dedupe key in a collection */
  id: string;
  name: string;
  avatarEmoji: string;
  color: string;
  /** the personal message the sender wrote on their card (may be empty) */
  message: string;
  /** epoch ms the sender minted/last-edited the card (travels in the QR) */
  at: number;
  /** epoch ms you received it by scanning — set locally on receipt, never in the QR */
  receivedAt?: number;
}

export interface RoomMeta {
  name: string;
  createdAt: number;
  emoji: string;
}

/** UI colour scheme preference. "auto" follows the OS via prefers-color-scheme;
 *  "light"/"dark" force a scheme. Default is "light" (see lib/theme.ts). */
export type ThemePref = "light" | "dark" | "auto";

/** Local-only profile persisted in localStorage. */
export interface Profile {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  /** small (≤256px) cover-cropped square JPEG data URL; users are attached to
   *  their avatars — this is the primary identity image (VRM portrait or upload) */
  avatarImage?: string;
  language: Language | "auto";
  /** UI theme preference; resolves to "light" when unset (see lib/theme.ts). */
  theme?: ThemePref;
  /** Show the 3D VRM companion (the one from vrmStorage) on the Home screen.
   *  Unset is treated as ON — a VRM, once set, greets you on Home by default. */
  showHomeVrm?: boolean;
  /** The personal message on your own exchangeable card (see Card / lib/cardQr.ts). */
  cardMessage?: string;
}

export interface JoinedRoom {
  roomId: string;
  name: string;
  lastOpened: number;
}

/** Aggregated, derived journey stats — input to gamification. */
export interface JourneyStats {
  countriesVisited: string[]; // unique lowercase country codes from pins+geo photos+geo diary
  companionsMet: string[]; // unique companion names across pins
  photoCount: number;
  arPhotoCount: number;
  diaryCount: number;
  pinCount: number;
  roomCount: number;
  streakDays: number;
  /** message cards collected face-to-face (proof of real-world meetings) */
  cardsCollected: number;
  /** distinct Japanese prefectures visited (derived from journey geo points) */
  prefecturesVisited: number;
}

export interface AchievementDef {
  id: string;
  /** i18n keys, e.g. "ach.firstSteps.title" / "ach.firstSteps.desc" */
  titleKey: string;
  descKey: string;
  icon: string; // emoji
  achieved: (s: JourneyStats) => boolean;
  /** Optional progress-to-unlock for countable achievements, used to render
   *  "N of M" meters on locked tiles and to pick the nearest "next goal".
   *  Omitted for one-shot/binary achievements (e.g. a single AR photo). */
  progress?: (s: JourneyStats) => { have: number; need: number };
}

/** A momentary reward the CelebrationHost surfaces when the derived state
 *  crosses a threshold (see lib/celebrate.ts). Purely a UI signal — the
 *  underlying progress is always the source of truth. */
export interface CelebrationEvent {
  kind: "level" | "achievement" | "streak";
  /** localized headline, e.g. "Level 4" / achievement title / "7-day streak" */
  title: string;
  /** localized supporting line, e.g. the rank name or achievement description */
  detail?: string;
  /** emoji / glyph shown in the burst */
  icon: string;
}

export interface RankInfo {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** i18n key of the rank title, e.g. "rank.wanderer" */
  titleKey: string;
}

/** Events for the Chronicle timeline, derived from room docs. */
export interface ChronicleEvent {
  at: number;
  kind: "photo" | "diary" | "pin" | "joined";
  roomId: string;
  summary: string; // pre-localized short line built by the caller
  icon: string; // emoji
}

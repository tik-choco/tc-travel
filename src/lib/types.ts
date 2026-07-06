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

export interface RoomMeta {
  name: string;
  createdAt: number;
  emoji: string;
}

/** Local-only profile persisted in localStorage. */
export interface Profile {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  language: Language | "auto";
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
}

export interface AchievementDef {
  id: string;
  /** i18n keys, e.g. "ach.firstSteps.title" / "ach.firstSteps.desc" */
  titleKey: string;
  descKey: string;
  icon: string; // emoji
  achieved: (s: JourneyStats) => boolean;
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

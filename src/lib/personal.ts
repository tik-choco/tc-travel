// Local-only personal store: profile, joined-room history, day-granularity
// usage streak, and the "journey" mirror — an idempotent, cross-room
// aggregate of every pin/photo-meta/diary-meta the user has ever seen, kept
// in localStorage so gamification (gamification.ts) has something to derive
// stats from even though mistlib only lets this page be in one room's Y.Doc
// at a time (see collab.ts / mistNode.ts's "one MistNode per page" note).
import { useEffect, useState } from "preact/hooks";
import type { DiaryEntry, EncounterPin, JoinedRoom, Photo, Profile } from "./types";
import { mistKvGet, mistKvSet } from "./mistKv";

const PROFILE_KEY = "tc-travel:profile";
const JOINED_ROOMS_KEY = "tc-travel:joinedRooms";
const STREAK_KEY = "tc-travel:streak";
const JOURNEY_KEY = "tc-travel:journey";

// --- profile -----------------------------------------------------------

const AVATAR_EMOJIS = ["\u{1F9ED}", "\u{1F5FA}️", "⚔️", "\u{1F6E1}️", "\u{1F3F9}", "\u{1F52E}", "\u{1F409}", "\u{1F989}"];
const PROFILE_COLORS = ["#d99a2b", "#c34f45", "#2b6f9e", "#4a8c58", "#d9694f", "#2fa094"];

/** The name every fresh profile starts with — exported so onboarding.ts can
 *  tell a genuinely new install apart from one that already personalized it. */
export const DEFAULT_PROFILE_NAME = "Wanderer";

function randomOf<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadProfileFromStorage(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    // fall through to a freshly generated profile
  }
  const profile: Profile = {
    id: crypto.randomUUID(),
    name: DEFAULT_PROFILE_NAME,
    color: randomOf(PROFILE_COLORS),
    avatarEmoji: randomOf(AVATAR_EMOJIS),
    language: "auto",
    theme: "light",
  };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.warn("tc-travel: failed to persist a freshly generated profile", error);
  }
  return profile;
}

let cachedProfile: Profile | null = null;
const profileListeners = new Set<() => void>();

/** Non-hook accessor for use outside components (store.ts's createRoom/addPin/etc). */
export function getProfile(): Profile {
  if (!cachedProfile) cachedProfile = loadProfileFromStorage();
  return cachedProfile;
}

/** Non-hook setter for use outside components (avatar.ts, store.ts, etc.) — same
 *  merge-and-persist behavior as the setter useProfile() returns. */
export function updateProfile(patch: Partial<Profile>): void {
  cachedProfile = { ...getProfile(), ...patch };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(cachedProfile));
  } catch (error) {
    console.warn("tc-travel: failed to persist profile update", error);
  }
  profileListeners.forEach((fn) => fn());
}

export function useProfile(): [Profile, (patch: Partial<Profile>) => void] {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    profileListeners.add(fn);
    return () => {
      profileListeners.delete(fn);
    };
  }, []);
  return [getProfile(), updateProfile];
}

// --- joined rooms --------------------------------------------------------

function loadJoinedRooms(): JoinedRoom[] {
  try {
    const raw = localStorage.getItem(JOINED_ROOMS_KEY);
    return raw ? (JSON.parse(raw) as JoinedRoom[]) : [];
  } catch {
    return [];
  }
}

const joinedRoomsListeners = new Set<() => void>();

function saveJoinedRooms(rooms: JoinedRoom[]): void {
  try {
    localStorage.setItem(JOINED_ROOMS_KEY, JSON.stringify(rooms));
  } catch (error) {
    console.warn("tc-travel: failed to persist joined-rooms list", error);
  }
  joinedRoomsListeners.forEach((fn) => fn());
}

/** Records/refreshes a room in the "recently opened" list. Called by store.ts on join/create. */
export function touchJoinedRoom(roomId: string, name: string): void {
  const rooms = loadJoinedRooms();
  const idx = rooms.findIndex((r) => r.roomId === roomId);
  const entry: JoinedRoom = { roomId, name: name || rooms[idx]?.name || "", lastOpened: Date.now() };
  if (idx >= 0) rooms[idx] = entry;
  else rooms.push(entry);
  saveJoinedRooms(rooms);
}

/** Non-hook count for use outside components (onboarding.ts's fresh-install check). */
export function joinedRoomCount(): number {
  return loadJoinedRooms().length;
}

export function useJoinedRooms(): JoinedRoom[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    joinedRoomsListeners.add(fn);
    return () => {
      joinedRoomsListeners.delete(fn);
    };
  }, []);
  return loadJoinedRooms().sort((a, b) => b.lastOpened - a.lastOpened);
}

// --- streak ---------------------------------------------------------------

interface StreakData {
  lastActiveDay: string; // "YYYY-MM-DD", local timezone
  count: number;
  /** high-water mark: the longest run ever achieved. Optional so streaks
   *  persisted before this field shipped still parse (see longestStreakDays
   *  for the read-side migration). */
  longest?: number;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? (JSON.parse(raw) as StreakData) : { lastActiveDay: "", count: 0 };
  } catch {
    return { lastActiveDay: "", count: 0 };
  }
}

function saveStreak(streak: StreakData): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  } catch (error) {
    console.warn("tc-travel: failed to persist usage streak", error);
  }
}

/** Call once on app start. Increments the streak if the last active day was yesterday, resets otherwise. */
export function touchStreak(): void {
  const today = dayKey(new Date());
  const streak = loadStreak();
  if (streak.lastActiveDay === today) return; // already counted today
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const count = streak.lastActiveDay === dayKey(yesterday) ? streak.count + 1 : 1;
  saveStreak({ lastActiveDay: today, count, longest: Math.max(streak.longest ?? streak.count, count) });
}

function currentStreakDays(): number {
  const streak = loadStreak();
  const today = dayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  // A streak only still counts if the user was active today or yesterday;
  // otherwise a day was missed and the run is over (touchStreak() will reset
  // `count` to 1 next time the app opens, but until then don't report a stale number).
  if (streak.lastActiveDay === today || streak.lastActiveDay === dayKey(yesterday)) return streak.count;
  return 0;
}

/** The longest streak ever achieved — the high-water mark the XP economy and
 *  streak achievements read, so a lapsed streak never costs earned progress.
 *  Streaks saved before `longest` shipped have no high-water mark yet; taking
 *  the max against the live count IS the migration (an active streak seeds it,
 *  a lapsed one starts from 0 and ratchets up from the next run). */
export function longestStreakDays(): number {
  return Math.max(loadStreak().longest ?? 0, currentStreakDays());
}

// --- journey mirror --------------------------------------------------------
//
// This mirror grows without bound over a traveller's lifetime (every pin's
// free-text note + companion names, forever) so it no longer lives as a
// single JSON blob in localStorage — it's kept in mistlib's OPFS-backed
// storage via mistKv.ts (a storage_add/storage_get-based KV shim; see that
// module's header for why it's not the real storage_kv_* yet), with only a
// small CID pointer left in localStorage (`${JOURNEY_KEY}:cid`).
//
// Every reader in this codebase (useJourney, memories.ts's
// useUnifiedJourney, gamification, etc.) expects synchronous access, so
// mist storage is fronted by an in-memory cache: `journeyCache` starts null
// (not yet hydrated), gets populated by a one-time async load (migrating a
// legacy localStorage blob if one is still there), and every read below
// falls back to an empty journey until that load resolves — at which point
// journeyListeners re-render whoever's subscribed. recordJourney(), called
// synchronously and often (on every room Y.Doc change), queues its
// read-modify-write onto `journeyMergeChain` so concurrent calls can't race
// each other, and the actual mist-storage write is trailing-debounced so a
// burst of doc changes costs one write instead of one per change.

interface JourneyStore {
  pins: EncounterPin[];
  photos: Omit<Photo, "cid">[];
  diary: Omit<DiaryEntry, "text">[];
}

function emptyJourney(): JourneyStore {
  return { pins: [], photos: [], diary: [] };
}

/** Best-effort synchronous read of the legacy localStorage blob, used only
 *  before journeyCache is hydrated — mirrors localMemories.ts's createKvList
 *  fallback so a one-shot synchronous consumer (if one is ever added here,
 *  same as onboarding.ts's shouldShowOnboarding for the solo store) sees an
 *  accurate answer on the very first call rather than a transient empty one. */
function journeySyncFallback(): JourneyStore {
  try {
    const raw = localStorage.getItem(JOURNEY_KEY);
    if (raw) return JSON.parse(raw) as JourneyStore;
  } catch {
    // fall through
  }
  return emptyJourney();
}

let journeyCache: JourneyStore | null = null;
let journeyLoadPromise: Promise<void> | null = null;

const journeyListeners = new Set<() => void>();
function notifyJourney(): void {
  journeyListeners.forEach((fn) => fn());
}

/** One-time hydration: try the mist-storage pointer first, then fall back to
 *  (and migrate away) a legacy full-blob localStorage copy, then an empty
 *  journey. Memoized via journeyLoadPromise so concurrent callers (a mounted
 *  useJourney() + an in-flight recordJourney()) converge on the same load. */
function ensureJourneyLoaded(): Promise<void> {
  if (journeyCache) return Promise.resolve();
  if (!journeyLoadPromise) {
    journeyLoadPromise = (async () => {
      const fromKv = await mistKvGet<JourneyStore>(JOURNEY_KEY);
      if (fromKv) {
        journeyCache = fromKv;
        return;
      }
      let legacy: JourneyStore | null = null;
      try {
        const raw = localStorage.getItem(JOURNEY_KEY);
        if (raw) legacy = JSON.parse(raw) as JourneyStore;
      } catch {
        legacy = null;
      }
      journeyCache = legacy ?? emptyJourney();
      if (legacy) {
        // Move the legacy blob into mist storage before dropping it from
        // localStorage — never remove until the migrated copy is confirmed
        // written, so a failure here just leaves the old data in place.
        try {
          await mistKvSet(JOURNEY_KEY, legacy);
          localStorage.removeItem(JOURNEY_KEY);
        } catch (error) {
          console.warn("tc-travel: journey migration to mist storage failed; keeping legacy localStorage copy", error);
        }
      }
    })().finally(() => {
      journeyLoadPromise = null;
    });
  }
  return journeyLoadPromise;
}

const JOURNEY_PERSIST_DELAY_MS = 1000;
let journeyPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** Trailing-debounced mist-storage write (mirrors docPersist.ts's ~1s flush
 *  window) so a burst of recordJourney calls (e.g. a room's initial Yjs
 *  sync) costs one write, not one per pin/photo/diary change. */
function scheduleJourneyPersist(journey: JourneyStore): void {
  if (journeyPersistTimer !== null) clearTimeout(journeyPersistTimer);
  journeyPersistTimer = setTimeout(() => {
    journeyPersistTimer = null;
    void mistKvSet(JOURNEY_KEY, journey).catch((error) => {
      console.warn("tc-travel: failed to persist journey mirror to mist storage", error);
    });
  }, JOURNEY_PERSIST_DELAY_MS);
}

function mergeJourney(
  journey: JourneyStore,
  snapshot: { pins: EncounterPin[]; photos: Photo[]; diary: DiaryEntry[] },
): JourneyStore {
  const pinsById = new Map(journey.pins.map((p) => [p.id, p]));
  for (const p of snapshot.pins) pinsById.set(p.id, p);

  const photosById = new Map(journey.photos.map((p) => [p.id, p]));
  for (const p of snapshot.photos) {
    const { cid: _cid, ...meta } = p;
    photosById.set(p.id, meta);
  }

  const diaryById = new Map(journey.diary.map((d) => [d.id, d]));
  for (const d of snapshot.diary) {
    const { text: _text, ...meta } = d;
    diaryById.set(d.id, meta);
  }

  return {
    pins: Array.from(pinsById.values()),
    photos: Array.from(photosById.values()),
    diary: Array.from(diaryById.values()),
  };
}

// Serializes recordJourney's read-modify-write over journeyCache: two
// concurrent calls (e.g. two rapid doc-change events) must not both read the
// same base and drop one merge.
let journeyMergeChain: Promise<void> = Promise.resolve();

/**
 * Merges a room's current pins/photos/diary into the local journey mirror,
 * keyed by id so replaying the same room snapshot (e.g. on every doc change)
 * is idempotent. Photo/diary entries are stripped of their heavy fields
 * (cid, full text) since the journey mirror only needs to support map
 * reveal + gamification stats, not full content. Also refreshes the
 * matching joined-room's lastOpened timestamp.
 */
export function recordJourney(
  roomId: string,
  snapshot: { pins: EncounterPin[]; photos: Photo[]; diary: DiaryEntry[] },
): void {
  journeyMergeChain = journeyMergeChain
    .then(() => ensureJourneyLoaded())
    .then(() => {
      const merged = mergeJourney(journeyCache ?? emptyJourney(), snapshot);
      journeyCache = merged;
      notifyJourney();
      scheduleJourneyPersist(merged);
    })
    .catch((error) => {
      console.warn("tc-travel: journey mirror update failed", error);
    });

  const rooms = loadJoinedRooms();
  const idx = rooms.findIndex((r) => r.roomId === roomId);
  if (idx >= 0) {
    rooms[idx] = { ...rooms[idx], lastOpened: Date.now() };
    saveJoinedRooms(rooms);
  }
}

export function useJourney(): {
  pins: EncounterPin[];
  photos: Omit<Photo, "cid">[];
  diary: Omit<DiaryEntry, "text">[];
  streakDays: number;
  longestStreakDays: number;
  roomCount: number;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    journeyListeners.add(fn);
    joinedRoomsListeners.add(fn); // roomCount depends on the joined-rooms list too
    return () => {
      journeyListeners.delete(fn);
      joinedRoomsListeners.delete(fn);
    };
  }, []);
  // Kick off (or join) the one-time hydration if nothing's loaded yet; the
  // journeyListeners re-render once it resolves. Safe to call every render —
  // ensureJourneyLoaded() is a no-op once journeyCache is populated.
  useEffect(() => {
    if (!journeyCache) void ensureJourneyLoaded().then(notifyJourney);
  }, []);
  const journey = journeyCache ?? journeySyncFallback();
  return {
    pins: journey.pins,
    photos: journey.photos,
    diary: journey.diary,
    streakDays: currentStreakDays(),
    longestStreakDays: longestStreakDays(),
    roomCount: loadJoinedRooms().length,
  };
}

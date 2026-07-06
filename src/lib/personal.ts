// Local-only personal store: profile, joined-room history, day-granularity
// usage streak, and the "journey" mirror — an idempotent, cross-room
// aggregate of every pin/photo-meta/diary-meta the user has ever seen, kept
// in localStorage so gamification (gamification.ts) has something to derive
// stats from even though mistlib only lets this page be in one room's Y.Doc
// at a time (see collab.ts / mistNode.ts's "one MistNode per page" note).
import { useEffect, useState } from "preact/hooks";
import type { DiaryEntry, EncounterPin, JoinedRoom, Photo, Profile } from "./types";

const PROFILE_KEY = "tc-travel:profile";
const JOINED_ROOMS_KEY = "tc-travel:joinedRooms";
const STREAK_KEY = "tc-travel:streak";
const JOURNEY_KEY = "tc-travel:journey";

// --- profile -----------------------------------------------------------

const AVATAR_EMOJIS = ["\u{1F9ED}", "\u{1F5FA}️", "⚔️", "\u{1F6E1}️", "\u{1F3F9}", "\u{1F52E}", "\u{1F409}", "\u{1F989}"];
const PROFILE_COLORS = ["#c9a227", "#8c2f28", "#4a6fa5", "#5a8f5a", "#a5527a", "#e8925c"];

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
    name: "Wanderer",
    color: randomOf(PROFILE_COLORS),
    avatarEmoji: randomOf(AVATAR_EMOJIS),
    language: "auto",
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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
  localStorage.setItem(PROFILE_KEY, JSON.stringify(cachedProfile));
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
  localStorage.setItem(JOINED_ROOMS_KEY, JSON.stringify(rooms));
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
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

/** Call once on app start. Increments the streak if the last active day was yesterday, resets otherwise. */
export function touchStreak(): void {
  const today = dayKey(new Date());
  const streak = loadStreak();
  if (streak.lastActiveDay === today) return; // already counted today
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const count = streak.lastActiveDay === dayKey(yesterday) ? streak.count + 1 : 1;
  saveStreak({ lastActiveDay: today, count });
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

// --- journey mirror --------------------------------------------------------

interface JourneyStore {
  pins: EncounterPin[];
  photos: Omit<Photo, "cid">[];
  diary: Omit<DiaryEntry, "text">[];
}

function loadJourney(): JourneyStore {
  try {
    const raw = localStorage.getItem(JOURNEY_KEY);
    if (raw) return JSON.parse(raw) as JourneyStore;
  } catch {
    // fall through to empty journey
  }
  return { pins: [], photos: [], diary: [] };
}

const journeyListeners = new Set<() => void>();

function saveJourney(journey: JourneyStore): void {
  localStorage.setItem(JOURNEY_KEY, JSON.stringify(journey));
  journeyListeners.forEach((fn) => fn());
}

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
  const journey = loadJourney();

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

  saveJourney({
    pins: Array.from(pinsById.values()),
    photos: Array.from(photosById.values()),
    diary: Array.from(diaryById.values()),
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
  const journey = loadJourney();
  return {
    pins: journey.pins,
    photos: journey.photos,
    diary: journey.diary,
    streakDays: currentStreakDays(),
    roomCount: loadJoinedRooms().length,
  };
}

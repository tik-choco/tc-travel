// The unified layer over a traveller's memories, wherever they live: the active
// P2P room's Y.Doc (store.ts) AND the always-there local solo store
// (local/localMemories.ts). UI reads the union and captures route by room
// presence, so:
//   - The P2P path (store.ts / collab.ts) stays byte-for-byte unchanged.
//   - Solo mode never touches CollabSession — capture goes to the local store.
//   - Fog reveal / stats / collection read useUnifiedJourney() (a drop-in for
//     personal.ts useJourney) and light up for solo memories exactly like room
//     ones, because it folds the local store's metadata in.
//
// Deliberately NOT dual-writing (a solo memory lives in exactly one place, the
// local store) — the union happens at read time, so there's no mirror to keep
// in sync and no divergence to debug.
import { useEffect, useState } from "preact/hooks";
import type { AlbumPhoto, DiaryEntry, EncounterPin, Photo } from "./types";
import { getProfile, useJourney } from "./personal";
import { ensureMistNode } from "./mistNode";
import { storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import {
  addDiaryEntry,
  addPhoto,
  addPin,
  inRoom,
  photosSnapshot,
  removeDiaryEntry,
  removePhoto,
  updateDiaryEntry,
  useDiary,
  usePhotos,
  usePhotoUrl,
} from "./store";
import {
  addLocalDiary,
  addLocalPhoto,
  addLocalPin,
  getLocalPhotoBytes,
  localSnapshot,
  removeLocalDiary,
  removeLocalPhoto,
  removeLocalPin,
  updateLocalDiary,
  useLocalDiary,
  useLocalPhotos,
  useLocalPins,
  type LocalPhoto,
} from "./local/localMemories";

// --- unified journey (drop-in for personal.ts useJourney) --------------------

/** Union of a value list by `id`, later entries winning. Room and local ids are
 *  distinct uuids, so this only ever guards against an accidental repeat. */
function unionById<T extends { id: string }>(...lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) for (const item of list) map.set(item.id, item);
  return [...map.values()];
}

function localPhotoToJourneyMeta(p: LocalPhoto): Omit<Photo, "cid"> {
  return {
    id: p.id,
    by: getProfile().id,
    at: p.at,
    caption: p.caption,
    geo: p.geo,
    width: p.width,
    height: p.height,
    arShot: p.arShot,
  };
}

/** Same shape as personal.ts useJourney(), with solo memories folded in.
 *  WorldMap, useJapanCollection and useJourneyStats read THIS so every derived
 *  surface (fog %, continent/prefecture counts, XP, achievements) counts solo
 *  and room memories together. */
export function useUnifiedJourney(): ReturnType<typeof useJourney> {
  const journey = useJourney();
  const localPins = useLocalPins();
  const localPhotos = useLocalPhotos();
  const localDiary = useLocalDiary();
  return {
    pins: unionById(journey.pins, localPins),
    photos: unionById(journey.photos, localPhotos.map(localPhotoToJourneyMeta)),
    // Journey diary is already text-stripped; strip the solo entries the same
    // way so the shapes match (the full solo text stays in the local store).
    diary: unionById(
      journey.diary,
      localDiary.map(({ text: _text, ...meta }) => meta),
    ),
    streakDays: journey.streakDays,
    longestStreakDays: journey.longestStreakDays,
    roomCount: journey.roomCount,
  };
}

// --- album photos (room + local, byte-resolvable) ----------------------------

/** Every photo the traveller can actually SEE right now — the active room's
 *  (bytes via mist cid) plus all solo photos (bytes via IndexedDB) — newest
 *  first. Past rooms the traveller isn't currently in aren't included: their
 *  bytes live only in that room's mist storage, unreachable while disconnected. */
export function useAlbumPhotos(): AlbumPhoto[] {
  const roomPhotos = usePhotos();
  const localPhotos = useLocalPhotos();
  const selfId = getProfile().id;
  const room: AlbumPhoto[] = roomPhotos.map((p) => ({
    id: p.id,
    source: "room",
    by: p.by,
    at: p.at,
    caption: p.caption,
    geo: p.geo,
    width: p.width,
    height: p.height,
    arShot: p.arShot,
    cid: p.cid,
  }));
  const local: AlbumPhoto[] = localPhotos.map((p) => ({
    id: p.id,
    source: "local",
    by: selfId,
    at: p.at,
    caption: p.caption,
    geo: p.geo,
    width: p.width,
    height: p.height,
    arShot: p.arShot,
  }));
  return [...room, ...local].sort((a, b) => b.at - a.at);
}

/** Non-hook union of every photo the traveller can currently see (room +
 *  local) — same shape as useAlbumPhotos, for callers that can't use hooks
 *  (e.g. the drive auto-export engine). */
export function albumPhotosSnapshot(): AlbumPhoto[] {
  const selfId = getProfile().id;
  const room: AlbumPhoto[] = photosSnapshot().map((p) => ({
    id: p.id,
    source: "room",
    by: p.by,
    at: p.at,
    caption: p.caption,
    geo: p.geo,
    width: p.width,
    height: p.height,
    arShot: p.arShot,
    cid: p.cid,
  }));
  const local: AlbumPhoto[] = localSnapshot().photos.map((p) => ({
    id: p.id,
    source: "local",
    by: selfId,
    at: p.at,
    caption: p.caption,
    geo: p.geo,
    width: p.width,
    height: p.height,
    arShot: p.arShot,
  }));
  return [...room, ...local].sort((a, b) => b.at - a.at);
}

/** Resolves an AlbumPhoto's raw bytes regardless of source — room via mist
 *  storage, local via IndexedDB. Returns null if unreachable right now (e.g.
 *  a room peer's bytes aren't synced yet). Shared by resolveAlbumPhotoUrl and
 *  the drive auto-export engine. */
export async function getAlbumPhotoBytes(photo: AlbumPhoto): Promise<Uint8Array | null> {
  if (photo.source === "local") return getLocalPhotoBytes(photo.id);
  if (!photo.cid) return null;
  await ensureMistNode();
  return new Uint8Array(await storage_get(photo.cid));
}

const localUrlCache = new Map<string, string>();

/** Resolves a solo photo's IndexedDB bytes to a cached ObjectURL. */
function useLocalObjectUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(id ? (localUrlCache.get(id) ?? null) : null);
  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    const cached = localUrlCache.get(id);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    setUrl(null);
    void getLocalPhotoBytes(id)
      .then((bytes) => {
        if (cancelled || !bytes) return;
        const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
        localUrlCache.set(id, objectUrl);
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        // missing bytes (cleared storage) — leave the placeholder in place
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return url;
}

/** cid→ObjectURL for room photos, IndexedDB→ObjectURL for solo photos. Both
 *  underlying hooks run every render (stable hook count); the return picks the
 *  one that matches this photo's source. */
export function useAlbumPhotoUrl(photo: AlbumPhoto | null): string | null {
  // usePhotoUrl only reads `.cid`, so a minimal stand-in is enough for room photos.
  const roomUrl = usePhotoUrl(photo && photo.source === "room" ? ({ cid: photo.cid } as Photo) : null);
  const localUrl = useLocalObjectUrl(photo && photo.source === "local" ? photo.id : null);
  return photo?.source === "local" ? localUrl : roomUrl;
}

export function removeAlbumPhoto(photo: AlbumPhoto): void {
  if (photo.source === "local") removeLocalPhoto(photo.id);
  else removePhoto(photo.id);
}

const albumUrlCache = new Map<string, string>();

/** Non-hook imperative resolver of a photo's bytes to a cached ObjectURL — for
 *  imperative consumers (the Three.js globe's photo billboards) that can't use
 *  the useAlbumPhotoUrl hook per marker. Solo photos come from IndexedDB, room
 *  photos from mist storage. Single-attempt + cached; returns null if the bytes
 *  aren't reachable (e.g. a room peer isn't connected yet — the caller re-reads
 *  useAlbumPhotos() on the next data change and can retry). */
export async function resolveAlbumPhotoUrl(photo: AlbumPhoto): Promise<string | null> {
  const key = `${photo.source}:${photo.source === "room" ? photo.cid : photo.id}`;
  const cached = albumUrlCache.get(key);
  if (cached) return cached;
  try {
    const bytes = await getAlbumPhotoBytes(photo);
    if (!bytes) return null;
    // Re-wrap for BlobPart (mistlib's Uint8Array isn't pinned to a plain
    // ArrayBuffer) — same shim as store.ts usePhotoUrl.
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
    albumUrlCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

// --- diary (room + local, full text, source-tagged) --------------------------

export type DiarySource = "room" | "local";
export type SourcedDiaryEntry = DiaryEntry & { source: DiarySource };

/** All diary entries the traveller can edit right now — room + solo — newest
 *  first, each tagged so edit/delete can route back to the right home. */
export function useDiaryEntries(): SourcedDiaryEntry[] {
  const roomDiary = useDiary();
  const localDiary = useLocalDiary();
  const room: SourcedDiaryEntry[] = roomDiary.map((d) => ({ ...d, source: "room" }));
  const local: SourcedDiaryEntry[] = localDiary.map((d) => ({ ...d, source: "local" }));
  return [...room, ...local].sort((a, b) => b.at - a.at);
}

// --- capture routing: room Y.Doc when in a party, local store when solo -------

export function addPhotoAuto(
  bytes: Uint8Array,
  meta: Omit<Photo, "id" | "cid" | "by" | "at">,
): Promise<unknown> {
  return inRoom() ? addPhoto(bytes, meta) : addLocalPhoto(bytes, meta);
}

export function addPinAuto(p: Omit<EncounterPin, "id" | "by" | "at">): void {
  if (inRoom()) addPin(p);
  else addLocalPin(p);
}

export function addDiaryAuto(e: Omit<DiaryEntry, "id" | "by" | "at">): void {
  if (inRoom()) addDiaryEntry(e);
  else addLocalDiary(e);
}

export function updateDiaryAuto(
  entry: SourcedDiaryEntry,
  patch: Partial<Pick<DiaryEntry, "title" | "text" | "mood">>,
): void {
  if (entry.source === "local") updateLocalDiary(entry.id, patch);
  else updateDiaryEntry(entry.id, patch);
}

export function removeDiaryAuto(entry: SourcedDiaryEntry): void {
  if (entry.source === "local") removeLocalDiary(entry.id);
  else removeDiaryEntry(entry.id);
}

// --- sharing solo memories into a room ---------------------------------------

export interface SoloShareResult {
  pins: number;
  diary: number;
  photos: number;
}

/** Publishes the traveller's solo memories into the CURRENT room — "the places
 *  I visited alone" become part of the party's shared chronicle. Photos
 *  re-upload their bytes to mist storage; pins/diary copy across. This DOES use
 *  the P2P path (it's an explicit, user-initiated share), unlike ordinary solo
 *  capture. No-op when not in a room. Best-effort per item so one failure
 *  doesn't abort the rest; optionally clears the local copies once shared. */
export async function shareSoloMemoriesToRoom(opts: { clearAfter?: boolean } = {}): Promise<SoloShareResult> {
  const result: SoloShareResult = { pins: 0, diary: 0, photos: 0 };
  if (!inRoom()) return result;
  const snap = localSnapshot();

  for (const p of snap.pins) {
    const { id: _id, by: _by, at: _at, ...rest } = p;
    addPin(rest);
    result.pins++;
  }
  for (const d of snap.diary) {
    const { id: _id, by: _by, at: _at, ...rest } = d;
    addDiaryEntry(rest);
    result.diary++;
  }
  for (const ph of snap.photos) {
    try {
      const bytes = await getLocalPhotoBytes(ph.id);
      if (!bytes) continue;
      await addPhoto(bytes, {
        caption: ph.caption,
        geo: ph.geo,
        width: ph.width,
        height: ph.height,
        arShot: ph.arShot,
      });
      result.photos++;
    } catch {
      // skip a single photo that fails to upload; the rest still share
    }
  }

  if (opts.clearAfter) {
    for (const ph of snap.photos) removeLocalPhoto(ph.id);
    for (const p of snap.pins) removeLocalPin(p.id);
    for (const d of snap.diary) removeLocalDiary(d.id);
  }
  return result;
}

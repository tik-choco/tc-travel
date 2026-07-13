// The P2P-INDEPENDENT "solo" memory store — the whole point of solo mode.
//
// Everything here is captured and read WITHOUT a CollabSession, mist node, or
// any peer: photo bytes live in IndexedDB, and photo metadata / pins / diary
// live in localStorage. So a traveller with no party can still record a place,
// pin an encounter, write a diary page, and see it all on the fog-of-war map —
// offline, forever local until they choose to share it.
//
// The P2P path (store.ts / collab.ts) is deliberately untouched: capture routes
// here (memories.ts addPhotoAuto/addPinAuto/addDiaryAuto) only when NOT in a
// room, and the unified read layer (memories.ts) merges this with the active
// room's Y.Doc. Derived systems (fog reveal, stats, prefecture/subnational
// collection) read the union via memories.ts useUnifiedJourney(), so solo
// memories light up the map exactly like room memories do.
import { useEffect, useState } from "preact/hooks";
import type { DiaryEntry, EncounterPin, GeoPoint } from "../types";
import { getProfile } from "../personal";
import { mistKvGet, mistKvSet } from "../mistKv";

const PINS_KEY = "tc-travel:solo:pins";
const PHOTOS_KEY = "tc-travel:solo:photos";
const DIARY_KEY = "tc-travel:solo:diary";

/** Solo photo metadata; the JPEG bytes live in IndexedDB keyed by `id`. Mirrors
 *  Photo minus the room-only fields (no mist `cid`, no member `by` — a solo
 *  photo is always the local profile's). */
export interface LocalPhoto {
  id: string;
  at: number;
  caption: string;
  geo: GeoPoint | null;
  width: number;
  height: number;
  arShot: boolean;
}

// --- tiny reactive localStorage list (same shape as personal.ts) -------------

function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // storage full / unavailable (private mode) — solo capture just doesn't
    // persist; nothing else should break.
  }
}

// One shared listener set: every solo mutation touches the journey-relevant
// union, so re-rendering all solo hooks together (like store.ts's coarse
// notify) is simplest and plenty fast at personal scale.
const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((fn) => fn());
}

function useLocalVersion(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
}

// --- pins/diary: mist-storage-backed lists (was raw localStorage) -----------
//
// Pins carry a free-text note + companion names, and diary entries carry the
// full entry text — both unbounded over a traveller's lifetime, so (per the
// storage remediation plan — see docs/INTEGRATION.md) they no longer live as
// a JSON blob in localStorage. They're kept in mistlib's OPFS-backed storage
// via mistKv.ts, with only a small CID pointer left in localStorage. Photos
// (PHOTOS_KEY, just metadata — the bytes are already in IndexedDB) are left
// on the plain loadList/saveList path below; they're small enough per audit.
//
// Every reader here (useLocalPins/useLocalDiary, localSnapshot,
// hasLocalMemories) expects synchronous access, so each list is fronted by
// an in-memory cache, hydrated once (migrating a legacy localStorage blob if
// one is still there) the first time anything reads or writes it. Mutations
// are serialized through a chain (so two rapid adds can't race and drop one)
// and the mist-storage write is trailing-debounced.
const KV_PERSIST_DELAY_MS = 800;

function createKvList<T>(key: string) {
  let cache: T[] | null = null;
  let loadPromise: Promise<void> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  function ensureLoaded(): Promise<void> {
    if (cache) return Promise.resolve();
    if (!loadPromise) {
      loadPromise = (async () => {
        const fromKv = await mistKvGet<T[]>(key);
        if (fromKv) {
          cache = fromKv;
          return;
        }
        let legacy: T[] | null = null;
        try {
          const raw = localStorage.getItem(key);
          if (raw) legacy = JSON.parse(raw) as T[];
        } catch {
          legacy = null;
        }
        cache = legacy ?? [];
        if (legacy) {
          // Move the legacy blob into mist storage before dropping it from
          // localStorage — never remove until the migrated copy is
          // confirmed written, so a failure here just leaves the old data.
          try {
            await mistKvSet(key, legacy);
            localStorage.removeItem(key);
          } catch (error) {
            console.warn(`tc-travel: migration of "${key}" to mist storage failed; keeping legacy localStorage copy`, error);
          }
        }
      })().finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  function schedulePersist(list: T[]): void {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void mistKvSet(key, list).catch((error) => {
        console.warn(`tc-travel: failed to persist "${key}" to mist storage`, error);
      });
    }, KV_PERSIST_DELAY_MS);
  }

  return {
    /** Synchronous read. Triggers hydration as a side effect if nothing has
     *  kicked it off yet. Before hydration resolves, falls back to a direct
     *  (best-effort) localStorage read of the legacy key rather than an
     *  empty list — some callers (onboarding.ts's shouldShowOnboarding, a
     *  one-shot check with no re-render to correct a transient answer) need
     *  an accurate result on the very first synchronous call, matching this
     *  module's pre-migration synchronous-localStorage contract. */
    get(): T[] {
      if (!cache && !loadPromise) void ensureLoaded().then(notify);
      if (cache) return cache;
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw) as T[];
      } catch {
        // fall through
      }
      return [];
    },
    /** Queues a read-modify-write; `fn` receives the current list (post
     *  hydration) and returns the next one. Notifies listeners once applied. */
    mutate(fn: (list: T[]) => T[]): void {
      chain = chain
        .then(() => ensureLoaded())
        .then(() => {
          const next = fn(cache ?? []);
          cache = next;
          notify();
          schedulePersist(next);
        })
        .catch((error) => {
          console.warn(`tc-travel: failed to update "${key}"`, error);
        });
    },
  };
}

const pinsList = createKvList<EncounterPin>(PINS_KEY);
const diaryList = createKvList<DiaryEntry>(DIARY_KEY);

// --- IndexedDB blob store for photo bytes ------------------------------------
// Separate DB from the VRM store (vrmStorage.ts) so the two never collide.

const DB_NAME = "tc-travel-photos";
const STORE_NAME = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open photo IndexedDB"));
  });
}

async function putBlob(id: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(bytes, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save photo bytes"));
    });
  } finally {
    db.close();
  }
}

export async function getLocalPhotoBytes(id: string): Promise<Uint8Array | null> {
  const db = await openDb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read photo bytes"));
    });
  } finally {
    db.close();
  }
}

async function deleteBlob(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete photo bytes"));
    });
  } finally {
    db.close();
  }
}

// --- photos ------------------------------------------------------------------

export function useLocalPhotos(): LocalPhoto[] {
  useLocalVersion();
  return loadList<LocalPhoto>(PHOTOS_KEY)
    .slice()
    .sort((a, b) => b.at - a.at);
}

/** Persists a solo photo: bytes → IndexedDB, metadata → localStorage. Returns
 *  the new id. Bytes are written first so a metadata entry never dangles
 *  without an image. */
export async function addLocalPhoto(
  bytes: Uint8Array,
  meta: Omit<LocalPhoto, "id" | "at">,
): Promise<string> {
  const id = crypto.randomUUID();
  await putBlob(id, bytes);
  const photo: LocalPhoto = { id, at: Date.now(), ...meta };
  saveList(PHOTOS_KEY, [...loadList<LocalPhoto>(PHOTOS_KEY), photo]);
  notify();
  return id;
}

export function removeLocalPhoto(id: string): void {
  saveList(
    PHOTOS_KEY,
    loadList<LocalPhoto>(PHOTOS_KEY).filter((p) => p.id !== id),
  );
  notify();
  // Bytes are best-effort cleanup — a failed delete only leaks IDB space, never
  // resurfaces the photo (its metadata is already gone).
  void deleteBlob(id).catch(() => {});
}

// --- pins --------------------------------------------------------------------

export function useLocalPins(): EncounterPin[] {
  useLocalVersion();
  return pinsList.get();
}

export function addLocalPin(p: Omit<EncounterPin, "id" | "by" | "at">): EncounterPin {
  const pin: EncounterPin = { id: crypto.randomUUID(), by: getProfile().id, at: Date.now(), ...p };
  pinsList.mutate((list) => [...list, pin]);
  return pin;
}

export function removeLocalPin(id: string): void {
  pinsList.mutate((list) => list.filter((p) => p.id !== id));
}

// --- diary -------------------------------------------------------------------
// Unlike the journey mirror (which strips diary text), the solo store keeps the
// FULL entry — it's the only home for solo diary content.

export function useLocalDiary(): DiaryEntry[] {
  useLocalVersion();
  return diaryList
    .get()
    .slice()
    .sort((a, b) => b.at - a.at);
}

export function addLocalDiary(e: Omit<DiaryEntry, "id" | "by" | "at">): DiaryEntry {
  const entry: DiaryEntry = { id: crypto.randomUUID(), by: getProfile().id, at: Date.now(), ...e };
  diaryList.mutate((list) => [...list, entry]);
  return entry;
}

export function updateLocalDiary(
  id: string,
  patch: Partial<Pick<DiaryEntry, "title" | "text" | "mood">>,
): void {
  diaryList.mutate((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

export function removeLocalDiary(id: string): void {
  diaryList.mutate((list) => list.filter((d) => d.id !== id));
}

// --- non-hook snapshot (for one-shot reads outside components) ---------------

export function localSnapshot(): { pins: EncounterPin[]; photos: LocalPhoto[]; diary: DiaryEntry[] } {
  return {
    pins: pinsList.get(),
    photos: loadList<LocalPhoto>(PHOTOS_KEY),
    diary: diaryList.get(),
  };
}

/** True once the traveller has recorded anything solo — cheap sync check used to
 *  decide whether to offer "share your solo memories" on joining a room. */
export function hasLocalMemories(): boolean {
  const snap = localSnapshot();
  return snap.pins.length > 0 || snap.photos.length > 0 || snap.diary.length > 0;
}

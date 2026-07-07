// Local persistence for the party room's Y.Doc, so shared memories survive
// every member closing the app. Without this, openSession() holds the room
// doc only in memory — if all phones close, the shared photos/pins/diary can
// never be restored (the personal.ts journey mirror strips photo cids and
// diary text, so it can't reconstruct them).
//
// One IndexedDB database, one object store, keyed by roomId, value = the full
// doc state as one Y.encodeStateAsUpdate() blob. Writes are debounced (~1s
// trailing) off the doc's 'update' event; a whole-state snapshot per write is
// tiny at meetup scale and keeps the store shape trivial (no update-log
// compaction). All storage failures are swallowed silently — mirroring
// celebrate.ts's saveLedger tolerance: in private mode etc. the room simply
// isn't restorable later, and nothing else breaks.
//
// There is deliberately NO deletion/cleanup flow: persisted docs are small,
// and keeping them forever is the feature (a room you rejoin months later
// still remembers).
import * as Y from "yjs";

const DB_NAME = "tc-travel-ydoc";
const STORE_NAME = "docs";
const FLUSH_DELAY_MS = 1000;

// Separate DB from the photo-bytes store (localMemories.ts) and the VRM store
// (vrmStorage.ts) so the three never collide. Same open/close-per-op pattern.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open ydoc IndexedDB"));
  });
}

/** Last-persisted doc state for a room, or null when missing OR on any storage
 *  error (private mode, corrupt value, no IndexedDB) — callers treat "can't
 *  load" exactly like "never saved". */
export async function loadDocState(roomId: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(roomId);
        req.onsuccess = () => {
          const value = req.result as unknown;
          resolve(value instanceof Uint8Array ? value : null);
        };
        req.onerror = () => reject(req.error ?? new Error("Failed to read ydoc state"));
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function saveDocState(roomId: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(bytes, roomId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save ydoc state"));
    });
  } finally {
    db.close();
  }
}

type PersistWriter = (roomId: string, bytes: Uint8Array) => void;

// Fire-and-forget: persistence must never block or fail a doc edit — same
// tolerance as celebrate.ts's saveLedger (storage unavailable in private mode
// etc. just means the doc won't be restorable; harmless).
const defaultWriter: PersistWriter = (roomId, bytes) => {
  void saveDocState(roomId, bytes).catch(() => {});
};

let writer: PersistWriter = defaultWriter;

/** @internal Test seam: the node test runner has no IndexedDB, so the
 *  debounce/flush/detach logic is exercised against an injected writer.
 *  Pass null to restore the real IndexedDB writer. */
export function __setDocPersistWriterForTest(fn: PersistWriter | null): void {
  writer = fn ?? defaultWriter;
}

/**
 * Subscribes to `doc.on("update")` and persists the full doc state, debounced
 * ~1s trailing so a burst of edits costs one write. Returns a detach function
 * that unsubscribes, clears any pending timer, and does a final flush (so the
 * last edits before leaving a room are never lost to the debounce window).
 */
export function attachDocPersistence(roomId: string, doc: Y.Doc): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let detached = false;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      writer(roomId, Y.encodeStateAsUpdate(doc));
    } catch {
      // storage unavailable — see module comment; the doc stays live in memory.
    }
  };

  const onUpdate = (): void => {
    if (detached) return;
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  };

  doc.on("update", onUpdate);

  return () => {
    if (detached) return;
    detached = true;
    doc.off("update", onUpdate);
    flush();
  };
}

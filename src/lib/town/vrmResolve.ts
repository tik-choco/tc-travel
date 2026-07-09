// Resolves the raw .vrm bytes for a tc-town CharacterIndexEntry. Two sources,
// tried in order:
//   1. The shared same-origin "tc-vrm-viewer" IndexedDB (same DB/store/schema
//      tc-town and tc-vrm-viewer both use for their VRM library — see
//      tc-town's src/vrm/library.ts, ported here read-only) — instant, no
//      network/mist round trip, and works even if tc-town's own mist node
//      never published the bytes anywhere.
//   2. mistlib storage_get(vrmCid) — cross-device fallback.
// Returns null if neither resolves; never throws.
import { ensureMistNode } from "../mistNode";
import { storage_get } from "../../vendor/mistlib/wrappers/web/index.js";
import type { CharacterIndexEntry } from "./characterIndex";

const DB_NAME = "tc-vrm-viewer";
const STORE_NAME = "models";

/** Only the fields of tc-vrm-viewer's FileRecord (src/storage/library.ts)
 *  this module reads. */
interface LibraryRecord {
  id: string;
  checksum?: string;
  dataUrl?: string;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("tc-travel: malformed VRM library dataUrl");
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Opens the DB WITHOUT forcing a version/upgrade, so this read-only visitor
// never clobbers the schema owned by tc-town/tc-vrm-viewer. If the DB
// genuinely doesn't exist yet on this origin, the browser still creates an
// empty (storeless) v1 database as a side effect of open() — unavoidable
// without indexedDB.databases() (not available in every browser) — but we
// never call createObjectStore ourselves, so the eventual real owner's own
// onupgradeneeded still runs normally against whatever version it requests.
function openLibraryDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    // No-op: deliberately does not create the object store. Reached only
    // when the DB doesn't exist yet on this origin (nothing to read).
    request.onupgradeneeded = () => {};
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function resolveFromLibraryDb(checksum: string): Promise<Uint8Array | null> {
  const db = await openLibraryDb();
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(STORE_NAME)) return null;
    const records = await new Promise<LibraryRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as LibraryRecord[]);
      request.onerror = () => reject(request.error);
    });
    const match = records.find((record) => record.checksum === checksum && typeof record.dataUrl === "string");
    if (!match?.dataUrl) return null;
    return dataUrlToBytes(match.dataUrl);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function resolveFromMistStorage(cid: string): Promise<Uint8Array | null> {
  try {
    await ensureMistNode();
    const raw = await storage_get(cid);
    return new Uint8Array(raw);
  } catch {
    return null;
  }
}

/** Resolves `.vrm` bytes for a tc-town character entry: the shared
 *  tc-vrm-viewer IndexedDB first (by vrmChecksum), then mistlib storage
 *  (by vrmCid). Returns null if unresolvable (persona-only entry, bytes not
 *  found locally and no vrmCid, or storage_get failure) — never throws. */
export async function resolveTownVrmBytes(
  entry: Pick<CharacterIndexEntry, "vrmChecksum" | "vrmCid">,
): Promise<Uint8Array | null> {
  if (entry.vrmChecksum) {
    const fromLibrary = await resolveFromLibraryDb(entry.vrmChecksum);
    if (fromLibrary) return fromLibrary;
  }
  if (entry.vrmCid) {
    const fromMist = await resolveFromMistStorage(entry.vrmCid);
    if (fromMist) return fromMist;
  }
  return null;
}

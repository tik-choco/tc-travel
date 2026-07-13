// Minimal content-addressed "KV" shim over mistlib's storage_add/storage_get.
//
// The storage remediation plan (see docs/INTEGRATION.md /
// protocol/docs/data-contracts) calls for large or ever-growing app-private
// data to move off localStorage into mistlib's OPFS-backed storage_kv_set/
// storage_kv_get/storage_kv_delete. The mistlib build currently vendored here
// (src/vendor/mistlib, see .mistlib-commit) does not export those yet — only
// the CID-addressed storage_add/storage_get. Until it does, "KV" is simulated
// on top of that: every write re-storage_add's the full value and keeps only
// the returned CID (a few dozen bytes) in localStorage under `${key}:cid`.
// Swap this module's internals for the real storage_kv_* calls once mistlib
// ships them; callers (mistKvSet/mistKvGet/mistKvDelete) shouldn't need to change.
import { storage_add, storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";

function pointerKey(key: string): string {
  return `${key}:cid`;
}

/** Reads the small localStorage pointer, if any. Never throws. */
function readPointer(key: string): string | null {
  try {
    return localStorage.getItem(pointerKey(key));
  } catch {
    return null;
  }
}

/** Stores `value` (JSON-serialized) into mistlib storage and updates the
 *  localStorage pointer to its cid. Throws on failure — callers decide how to
 *  handle a failed persist (typically: keep the in-memory copy, warn, retry
 *  next write). */
export async function mistKvSet(key: string, value: unknown): Promise<void> {
  await ensureMistNode();
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const cid = await storage_add(key, bytes);
  // Small (~60 byte) pointer write — still quota-guarded per the app-wide rule.
  try {
    localStorage.setItem(pointerKey(key), cid);
  } catch (error) {
    console.warn(`tc-travel: failed to persist mistKv pointer for "${key}"`, error);
  }
}

/** Resolves the current value for `key`, or null if there's no pointer yet or
 *  the fetch/parse fails (treated the same as "nothing stored"). */
export async function mistKvGet<T>(key: string): Promise<T | null> {
  const cid = readPointer(key);
  if (!cid) return null;
  try {
    await ensureMistNode();
    const raw = await storage_get(cid);
    const text = new TextDecoder().decode(new Uint8Array(raw));
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Drops the local pointer (the mistlib-side blob is simply orphaned — this
 *  shim has no delete primitive to call, same as real storage_kv_delete would
 *  eventually need). */
export function mistKvDeletePointer(key: string): void {
  try {
    localStorage.removeItem(pointerKey(key));
  } catch {
    // best-effort
  }
}

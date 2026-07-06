// Read-only bridge into tc-storage's shared localStorage state — see
// docs/INTEGRATION.md "reader.ts (Agent B)". tc-travel never writes
// `tc-storage-snapshot-v1` or `tc-storage-folder-keys-v1` (that's owned by
// whichever tc-storage tab is open); this module only resolves file bytes
// for features like VRM import (see ARCameraScreen.tsx).
import { ensureMistNode } from "../mistNode";
import { storage_get } from "../../vendor/mistlib/wrappers/web/index.js";
import { decryptJson } from "./crypto";
import type { FileBundle, FileRecord, FolderRecord, StorageSnapshot } from "./types";

const SNAPSHOT_KEY = "tc-storage-snapshot-v1";
const FOLDER_KEYS_KEY = "tc-storage-folder-keys-v1";

export interface TcStorageFileEntry {
  /** dataUrl is absent — persisted snapshots strip file content (see
   *  tc-storage's stripSnapshotFileContent). Bytes are fetched on demand via
   *  loadTcStorageFileBytes(). */
  file: FileRecord;
  /** "Folder/Subfolder" display path, root-to-leaf. */
  path: string;
  /** Own folder's key, else the nearest ancestor folder's key. null = not decryptable. */
  passphrase: string | null;
}

function loadSnapshot(): StorageSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StorageSnapshot;
    if (!Array.isArray(parsed?.folders) || !Array.isArray(parsed?.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadFolderKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FOLDER_KEYS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Own folder key, else walk parentId upward for the nearest ancestor that has one. */
function resolvePassphrase(
  folderId: string | null,
  foldersById: Map<string, FolderRecord>,
  keys: Record<string, string>,
): string | null {
  const visited = new Set<string>();
  let current = folderId ? foldersById.get(folderId) : undefined;
  while (current) {
    if (visited.has(current.id)) return null; // cycle guard
    visited.add(current.id);
    const key = keys[current.id];
    if (key) return key;
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }
  return null;
}

function buildPath(folderId: string | null, foldersById: Map<string, FolderRecord>): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = folderId ? foldersById.get(folderId) : undefined;
  while (current) {
    if (visited.has(current.id)) break; // cycle guard
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }
  return names.join("/");
}

/** tc-storage workspace file listing (soft-deleted files/folders excluded).
 *  extensions, if given, filters by lowercase suffix (e.g. [".vrm"]). Defensive:
 *  a missing or corrupt snapshot yields an empty list rather than throwing. */
export function listTcStorageFiles(options?: { extensions?: string[] }): TcStorageFileEntry[] {
  const snapshot = loadSnapshot();
  if (!snapshot) return [];
  const keys = loadFolderKeys();
  const foldersById = new Map<string, FolderRecord>();
  for (const folder of snapshot.folders) {
    if (!folder.deletedAt) foldersById.set(folder.id, folder);
  }
  const extensions = options?.extensions?.map((ext) => ext.toLowerCase());
  const entries: TcStorageFileEntry[] = [];
  for (const file of snapshot.files) {
    if (file.deletedAt) continue;
    if (extensions && !extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) continue;
    entries.push({
      file,
      path: buildPath(file.folderId, foldersById),
      passphrase: resolvePassphrase(file.folderId, foldersById, keys),
    });
  }
  return entries;
}

// Mirrors avatar.ts/store.ts's dataUrlToBytes — kept local per the contract
// rather than pulled from crypto.ts, since it isn't part of tc-storage's
// crypto module (it's plain data-URL decoding, not encryption).
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** lastCid -> storage_get -> encrypted envelope JSON -> decryptJson<FileBundle>
 *  -> dataUrl -> bytes. Throws if lastCid/passphrase is missing or decryption fails. */
export async function loadTcStorageFileBytes(entry: TcStorageFileEntry): Promise<Uint8Array> {
  const { file, passphrase } = entry;
  if (!file.lastCid) throw new Error(`tc-travel: "${file.name}" has no lastCid to load from mist storage`);
  if (!passphrase) throw new Error(`tc-travel: no resolvable passphrase for "${file.name}"`);

  await ensureMistNode();
  const raw = await storage_get(file.lastCid);
  const text = new TextDecoder().decode(new Uint8Array(raw));
  // Typed off decryptJson's own parameter rather than importing EncryptedPayload
  // by name, so this compiles regardless of exactly which type crypto.ts re-exports.
  const envelope = JSON.parse(text) as Parameters<typeof decryptJson>[0];
  const bundle = await decryptJson<FileBundle>(envelope, passphrase);
  if (!bundle.file.dataUrl) throw new Error(`tc-travel: decrypted bundle for "${file.name}" has no dataUrl`);
  return dataUrlToBytes(bundle.file.dataUrl);
}

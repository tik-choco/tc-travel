// Read-only bridge into the shared "drive-index" bus topic — see
// docs/INTEGRATION.md. tc-travel never reads a drive app's own workspace
// state (snapshot, folder keys) directly; the drive app publishes an index
// of its loadable files, and this module only resolves file bytes from that
// index for features like VRM import (see ARCameraScreen.tsx).
import { ensureMistNode } from "../mistNode";
import { storage_get } from "../../vendor/mistlib/wrappers/web/index.js";
import { decryptJson } from "./crypto";
import { readShared } from "./sharedBus";
import type { FileBundle } from "./types";

const DRIVE_INDEX_TOPIC = "drive-index";
const DRIVE_INDEX_VERSION = 1;

/** Wire shape published by a drive-implementing app under the `drive-index`
 *  shared-bus topic — see docs/INTEGRATION.md. Listing is restricted to
 *  files that are neither deleted nor missing a resolvable decryption key,
 *  so every entry here is loadable by construction. */
export interface DriveIndexEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** mist CID of the encrypted FileBundle. */
  lastCid: string;
  /** "Folder/Subfolder" display path, root-to-leaf. */
  path: string;
  /** FileBundle decryption key. */
  passphrase: string;
}

/** What listDriveFiles() hands back — structurally the same as DriveIndexEntry
 *  today, kept as a distinct alias so callers depend on the reader's own
 *  contract rather than the shared-bus wire shape directly. */
export type DriveFileEntry = DriveIndexEntry;

interface DriveIndexMeta {
  version: 1;
  updatedAt: string;
  files: DriveIndexEntry[];
}

function isDriveIndexEntry(value: unknown): value is DriveIndexEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.mimeType === "string" &&
    typeof entry.size === "number" &&
    typeof entry.lastCid === "string" &&
    typeof entry.path === "string" &&
    typeof entry.passphrase === "string"
  );
}

// Defensive: a wrong version, malformed shape, or absent index all yield an
// empty list rather than throwing — this is untrusted cross-app input.
function readDriveIndex(): DriveIndexEntry[] {
  const record = readShared(DRIVE_INDEX_TOPIC);
  if (!record) return [];
  const meta = record.meta as Partial<DriveIndexMeta> | undefined;
  if (!meta || meta.version !== DRIVE_INDEX_VERSION || !Array.isArray(meta.files)) return [];
  return meta.files.filter(isDriveIndexEntry);
}

/** Drive file listing, restricted to loadable files (the index only ever
 *  lists those — see DriveIndexEntry). extensions, if given, filters by
 *  lowercase suffix (e.g. [".vrm"]). Defensive: a missing or corrupt index
 *  yields an empty list rather than throwing. */
export function listDriveFiles(options?: { extensions?: string[] }): DriveFileEntry[] {
  const entries = readDriveIndex();
  const extensions = options?.extensions?.map((ext) => ext.toLowerCase());
  if (!extensions) return entries;
  return entries.filter((entry) => extensions.some((ext) => entry.name.toLowerCase().endsWith(ext)));
}

// Mirrors avatar.ts/store.ts's dataUrlToBytes — kept local since it's plain
// data-URL decoding, not encryption, so it doesn't belong in crypto.ts.
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** lastCid -> storage_get -> encrypted envelope JSON -> decryptJson<FileBundle>
 *  -> dataUrl -> bytes. Throws if decryption fails or the bundle has no dataUrl. */
export async function loadDriveFileBytes(entry: DriveFileEntry): Promise<Uint8Array> {
  await ensureMistNode();
  const raw = await storage_get(entry.lastCid);
  const text = new TextDecoder().decode(new Uint8Array(raw));
  // Typed off decryptJson's own parameter rather than importing EncryptedPayload
  // by name, so this compiles regardless of exactly which type crypto.ts re-exports.
  const envelope = JSON.parse(text) as Parameters<typeof decryptJson>[0];
  const bundle = await decryptJson<FileBundle>(envelope, entry.passphrase);
  if (!bundle.file.dataUrl) throw new Error(`tc-travel: decrypted bundle for "${entry.name}" has no dataUrl`);
  return dataUrlToBytes(bundle.file.dataUrl);
}

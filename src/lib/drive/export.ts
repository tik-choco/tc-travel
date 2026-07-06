// Writes tc-travel photos into the family's neutral encrypted-bundle format
// (a FolderBundle/FileBundle written to mist storage, announced on the
// shared bus's `folder-export` topic) so any drive-implementing app can pick
// them up via its own CRDT merge. See docs/INTEGRATION.md — tc-travel must
// never touch a drive app's own workspace state directly, only publish
// through the shared bus.
import { storage_add } from "../../vendor/mistlib/wrappers/web/index.js";
import { currentNodeId, ensureMistNode } from "../mistNode";
import { bytesToBase64, encryptJson, generateFolderKey, sha256Hex } from "./crypto";
import { publishShared } from "./sharedBus";
import type { FileBundle, FileRecord, FolderBundle, FolderRecord, VersionStamp } from "./types";

export const FOLDER_EXPORT_TOPIC = "folder-export";

const STATE_KEY = "tc-travel:driveExport";
// Read-migrated from, then retired — see loadState/saveState below.
const LEGACY_STATE_KEY = "tc-travel:tcStorageExport";
const FOLDER_NAME = "TC Travel";
const MIME_TYPE = "image/jpeg";

// Mirrors the drive contract's per-field {updatedAt, nodeId} stamping rules
// (see docs/INTEGRATION.md / protocol/docs/data-contracts) used for LWW
// merging on the reading app's side. `dataUrl` is deliberately excluded.
const FILE_FIELDS = [
  "folderId",
  "sortOrder",
  "name",
  "mimeType",
  "size",
  "checksum",
  "version",
  "starred",
  "lastCid",
  "lastShareCid",
  "deletedAt",
] as const;

interface DriveExportState {
  folderId: string;
  passphrase: string;
  /** The folder record exactly as first created (fieldVersions stamped once,
   *  at creation). Re-exports MUST reuse this verbatim: rebuilding it with
   *  fresh stamps would make the reading app's per-field LWW merge silently
   *  revert any rename/move/share the user did to the folder there. */
  folder?: FolderRecord;
  /** dataUrl-stripped, lastCid-bearing source of truth — see stripFileContent. */
  files: FileRecord[];
}

const encoder = new TextEncoder();

/** In-memory mirror of the persisted state: if localStorage writes fail
 *  (quota, private browsing), later exports in this session still reuse the
 *  same folder + passphrase instead of fragmenting into one folder per photo. */
let memoryState: DriveExportState | null = null;

function parseState(raw: string): DriveExportState | null {
  const parsed = JSON.parse(raw) as Partial<DriveExportState> | null;
  if (!parsed || typeof parsed.folderId !== "string" || typeof parsed.passphrase !== "string" || !Array.isArray(parsed.files)) {
    return null;
  }
  const folder =
    parsed.folder && typeof parsed.folder === "object" && typeof parsed.folder.id === "string" ? parsed.folder : undefined;
  return { folderId: parsed.folderId, passphrase: parsed.passphrase, folder, files: parsed.files as FileRecord[] };
}

// Tries the current key first; if absent, falls back to the legacy
// (pre-rename) key so an existing exporter's folder is reused rather than
// forked into a second one. The legacy key is only removed on the next
// saveState — this function never writes.
function loadState(): DriveExportState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return parseState(raw) ?? memoryState;
    const legacyRaw = localStorage.getItem(LEGACY_STATE_KEY);
    if (legacyRaw) return parseState(legacyRaw) ?? memoryState;
    return memoryState;
  } catch {
    return memoryState;
  }
}

function saveState(state: DriveExportState): void {
  memoryState = state;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_STATE_KEY);
  } catch (error) {
    console.warn("tc-travel: failed to persist driveExport state", error);
  }
}

function fileRecordId(photoId: string): string {
  return `file-travel-${photoId}`;
}

/** Whether this photo has already been exported at least once — used by
 *  PhotoViewer to switch the export action into a "saved" state. */
export function isPhotoExported(photoId: string): boolean {
  const state = loadState();
  if (!state) return false;
  const id = fileRecordId(photoId);
  return state.files.some((file) => file.id === id);
}

function pad(value: number, length = 2): string {
  return value.toString().padStart(length, "0");
}

function formatTimestampFileName(at: number): string {
  const d = new Date(at);
  return `travel-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sanitizeCaptionForFileName(caption: string): string {
  return caption
    .trim()
    .replace(/[\\/:*?"<>| -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function deriveFileName(caption: string, at: number): string {
  const sanitized = sanitizeCaptionForFileName(caption);
  return `${sanitized || formatTimestampFileName(at)}.jpg`;
}

function dataUrlFromBytes(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

// Strips the raw content (and its now-meaningless fieldVersions entry, since
// dataUrl isn't a versioned field to begin with) before a FileRecord goes
// into a FolderBundle or the persisted export state.
function stripFileContent(file: FileRecord): FileRecord {
  const { dataUrl: _dataUrl, fieldVersions, ...rest } = file;
  if (!fieldVersions?.dataUrl) return { ...rest, fieldVersions };
  const { dataUrl: _dataUrlVersion, ...versions } = fieldVersions;
  return { ...rest, fieldVersions: versions };
}

// On first creation, every field gets the same fresh stamp (used for both
// FolderRecord and a brand-new FileRecord).
function stampAllFields<T extends { fieldVersions?: Record<string, VersionStamp>; updatedAt: string }>(
  record: T,
  updatedAt: string,
  nodeId: string,
): T {
  const fieldVersions: Record<string, VersionStamp> = {};
  for (const key of Object.keys(record)) {
    if (key !== "fieldVersions") fieldVersions[key] = { updatedAt, nodeId };
  }
  return { ...record, fieldVersions };
}

// On re-export, only the fields that actually changed get a fresh stamp, so
// the reading app's per-field LWW merge doesn't clobber unrelated fields a
// user may have edited locally.
function stampFilePatch(file: FileRecord, patch: Partial<FileRecord>, updatedAt: string, nodeId: string): FileRecord {
  const fields: readonly string[] = FILE_FIELDS;
  const touched = Object.keys(patch).filter((key) => fields.includes(key));
  const fieldVersions = { ...(file.fieldVersions ?? {}) };
  for (const field of touched) fieldVersions[field] = { updatedAt, nodeId };
  return { ...file, ...patch, fieldVersions, updatedAt };
}

// A drive app's own createFolder typically derives sharedRoomId from a
// single long-lived per-app-instance roomId. tc-travel has no equivalent
// standing "room" concept, and the export state we're allowed to persist is
// fixed to {folderId, passphrase, files} (no room slot) — so instead of
// generating (and having to separately persist) a random roomId, this derives
// one deterministically from the stable folderId. That keeps the value
// constant across re-exports without adding to the persisted shape, and
// avoids needlessly re-stamping this CRDT-versioned field on every export.
function deriveSharedRoomId(folderId: string): string {
  return `tc-travel-${folderId.replace(/^folder-travel-/, "")}`;
}

function buildFolderRecord(folderId: string, now: string, nodeId: string): FolderRecord {
  const folder: FolderRecord = {
    id: folderId,
    name: FOLDER_NAME,
    parentId: null,
    sortOrder: Date.parse(now),
    color: "teal",
    encrypted: true,
    shareEnabled: false,
    sharedRoomId: deriveSharedRoomId(folderId),
    createdAt: now,
    updatedAt: now,
  };
  return stampAllFields(folder, now, nodeId);
}

interface ExportPhotoInput {
  photoId: string;
  bytes: Uint8Array;
  caption: string;
  at: number;
}

/** Serializes exports: the whole flow is a read-modify-write over the
 *  persisted state (loadState → updatedFiles → saveState), so two concurrent
 *  exports would drop one photo from the folder bundle. */
let exportChain: Promise<unknown> = Promise.resolve();

/** Exports one photo into the shared "TC Travel" drive folder, creating the
 *  folder on first use. Re-exporting the same photoId updates the same
 *  FileRecord (bumping version, restamping only changed fields) instead of
 *  duplicating it. Failure is not swallowed — callers should show it. */
export function exportPhotoToDrive(input: ExportPhotoInput): Promise<void> {
  const run = exportChain.then(() => doExportPhoto(input));
  exportChain = run.catch(() => undefined); // keep the queue alive after a failed export
  return run;
}

async function doExportPhoto(input: ExportPhotoInput): Promise<void> {
  await ensureMistNode();
  const nodeId = currentNodeId();
  const now = new Date().toISOString();

  let state = loadState();
  if (!state) {
    const folderId = `folder-travel-${crypto.randomUUID()}`;
    state = {
      folderId,
      passphrase: generateFolderKey(),
      folder: buildFolderRecord(folderId, now, nodeId),
      files: [],
    };
    // Persist immediately: even if the rest of this export fails below,
    // retries (or exporting a different photo) reuse the same folder and
    // passphrase instead of splitting the album across multiple folders.
    saveState(state);
  } else if (!state.folder) {
    // State persisted by a pre-`folder` version of this module: rebuild the
    // record once and persist it so every later export reuses these stamps.
    state = { ...state, folder: buildFolderRecord(state.folderId, now, nodeId) };
    saveState(state);
  }
  // Reused verbatim on re-export — never re-stamp (see DriveExportState.folder).
  const folder = state.folder as FolderRecord;

  const size = input.bytes.byteLength;
  const checksum = await sha256Hex(input.bytes);
  const dataUrl = dataUrlFromBytes(input.bytes, MIME_TYPE);
  const name = deriveFileName(input.caption, input.at);

  const fileId = fileRecordId(input.photoId);
  const existingIndex = state.files.findIndex((file) => file.id === fileId);

  let fileRecord: FileRecord;
  if (existingIndex >= 0) {
    const existing = state.files[existingIndex];
    const patch: Partial<FileRecord> = { version: existing.version + 1 };
    if (existing.name !== name) patch.name = name;
    if (existing.mimeType !== MIME_TYPE) patch.mimeType = MIME_TYPE;
    if (existing.size !== size) patch.size = size;
    if (existing.checksum !== checksum) patch.checksum = checksum;
    fileRecord = { ...stampFilePatch(existing, patch, now, nodeId), dataUrl };
  } else {
    const created: FileRecord = {
      id: fileId,
      folderId: state.folderId,
      sortOrder: Date.parse(now),
      name,
      mimeType: MIME_TYPE,
      size,
      dataUrl,
      checksum,
      version: 1,
      starred: false,
      createdAt: now,
      updatedAt: now,
    };
    fileRecord = stampAllFields(created, now, nodeId);
  }

  const fileBundle: FileBundle = { version: 1, exportedAt: now, originNode: nodeId, folder, file: fileRecord };
  const encryptedFile = await encryptJson(fileBundle, state.passphrase);
  const fileCid = await storage_add(`${fileId}.tc-file.enc.json`, encoder.encode(JSON.stringify(encryptedFile)));
  fileRecord = stampFilePatch(fileRecord, { lastCid: fileCid }, new Date().toISOString(), nodeId);

  const updatedFiles =
    existingIndex >= 0
      ? state.files.map((file, index) => (index === existingIndex ? fileRecord : file))
      : [...state.files, fileRecord];

  const folderExportedAt = new Date().toISOString();
  const folderBundle: FolderBundle = {
    version: 1,
    exportedAt: folderExportedAt,
    originNode: nodeId,
    folder,
    files: updatedFiles.map(stripFileContent),
  };
  const encryptedFolder = await encryptJson(folderBundle, state.passphrase);
  const folderCid = await storage_add(`${state.folderId}.tc-folder.enc.json`, encoder.encode(JSON.stringify(encryptedFolder)));

  state = { ...state, files: updatedFiles };
  saveState(state);

  publishShared(FOLDER_EXPORT_TOPIC, folderCid, {
    folderId: state.folderId,
    folderName: folder.name,
    passphrase: state.passphrase,
    fileCount: updatedFiles.length,
    exportedAt: folderExportedAt,
  });
}

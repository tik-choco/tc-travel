// Read-only bridge into the shared "character-index" bus topic, published by
// tc-town (see docs' cross-app shared-bus contract). Lets tc-travel offer a
// tc-town character as a VRM companion + AI persona. Mirrors reader.ts's
// pattern (../drive/reader.ts): this app never trusts the record — every
// field is coerced and invalid entries are dropped rather than throwing.
import { ensureMistNode } from "../mistNode";
import { storage_get } from "../../vendor/mistlib/wrappers/web/index.js";
import { readShared, subscribeShared } from "../drive/sharedBus";

const CHARACTER_INDEX_TOPIC = "character-index";
const CHARACTER_INDEX_VERSION = 1;

/** Wire shape published under the `character-index` shared-bus topic.
 *  Entries without vrmChecksum/vrmCid are persona-only characters (image or
 *  no avatar) — callers must handle that case rather than assuming a VRM.
 *
 *  personaPrompt is optional: newer tc-town builds publish a slim listing
 *  meta (id/name/summary/vrm fields only, for the chooser UI) and
 *  content-address the full entries (personaPrompt included) via the
 *  shared-bus record's `cid`. Callers that need the prompt text should go
 *  through resolvePersonaPrompt() rather than reading the field directly. */
export interface CharacterIndexEntry {
  /** tc-town character id. */
  id: string;
  name: string;
  /** One-line description. */
  summary: string;
  /** Fully compiled system-prompt persona text (Japanese sections). Present
   *  inline for the older, unslimmed listing format — see resolvePersonaPrompt(). */
  personaPrompt?: string;
  /** sha256 hex — resolves in the shared same-origin "tc-vrm-viewer" IndexedDB. */
  vrmChecksum?: string;
  /** mistlib storage CID of the raw .vrm bytes (fallback / cross-device). */
  vrmCid?: string;
  vrmFileName?: string;
  voiceModel?: string;
  voiceName?: string;
  /** ISO 8601. */
  updatedAt: string;
}

interface CharacterIndexMeta {
  v: 1;
  updatedAt: string;
  entries: CharacterIndexEntry[];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Defensive, field-by-field: this is untrusted cross-app input (a wrong
// version, malformed shape, or a single bad field must not take down the
// whole list) — mirrors reader.ts's isDriveIndexEntry, but coerces optional
// fields individually instead of an all-or-nothing shape check.
function toEntry(value: unknown): CharacterIndexEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const id = asString(raw.id);
  const name = asString(raw.name);
  const summary = asString(raw.summary);
  const updatedAt = asString(raw.updatedAt);
  if (!id || !name || !summary || !updatedAt) return null;

  const entry: CharacterIndexEntry = { id, name, summary, updatedAt };
  const personaPrompt = asString(raw.personaPrompt);
  if (personaPrompt) entry.personaPrompt = personaPrompt;
  const vrmChecksum = asString(raw.vrmChecksum);
  if (vrmChecksum) entry.vrmChecksum = vrmChecksum;
  const vrmCid = asString(raw.vrmCid);
  if (vrmCid) entry.vrmCid = vrmCid;
  const vrmFileName = asString(raw.vrmFileName);
  if (vrmFileName) entry.vrmFileName = vrmFileName;
  const voiceModel = asString(raw.voiceModel);
  if (voiceModel) entry.voiceModel = voiceModel;
  const voiceName = asString(raw.voiceName);
  if (voiceName) entry.voiceName = voiceName;
  return entry;
}

// The storage_add'd payload (see tc-town's characterIndexPublisher.ts) is the
// full CharacterIndexMeta `{v, updatedAt, entries: CharacterIndexEntry[]}` —
// the same wrapped shape published for the whole index, just JSON'd as a
// whole for content-addressing. Some builds may instead storage_add a bare
// CharacterIndexEntry[]. Accept either.
export function extractCharacterIndexList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return (parsed as { entries: unknown[] }).entries;
  }
  return null;
}

// Defensive: a wrong version, malformed shape, or absent index all yield an
// empty list rather than throwing.
function readCharacterIndex(): CharacterIndexEntry[] {
  const record = readShared(CHARACTER_INDEX_TOPIC);
  if (!record) return [];
  const meta = record.meta as Partial<CharacterIndexMeta> | undefined;
  if (!meta || meta.v !== CHARACTER_INDEX_VERSION || !Array.isArray(meta.entries)) return [];
  const entries: CharacterIndexEntry[] = [];
  for (const rawEntry of meta.entries) {
    const entry = toEntry(rawEntry);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** tc-town's published character roster. Defensive: a missing or corrupt
 *  index yields an empty list rather than throwing — callers should treat an
 *  empty list as "no tc-town characters available" and hide that UI path. */
export function loadTownCharacters(): CharacterIndexEntry[] {
  return readCharacterIndex();
}

/** Subscribes to roster updates (tc-town republishing its index). Callback
 *  receives the freshly re-read, defensively-parsed list each time. Returns
 *  an unsubscribe function. */
export function subscribeTownCharacters(callback: (entries: CharacterIndexEntry[]) => void): () => void {
  return subscribeShared(CHARACTER_INDEX_TOPIC, () => callback(readCharacterIndex()));
}

/** Resolves the full persona-prompt text for a roster entry. Dual-read: if
 *  the entry already carries personaPrompt inline (older tc-town listing
 *  format), use it as-is; otherwise fetch the full, unslimmed index from the
 *  shared-bus record's `cid` (mistlib storage_get) and look the entry up by
 *  id there. Returns undefined if the prompt can't be resolved either way —
 *  callers should treat that as "persona unavailable", not throw. */
export async function resolvePersonaPrompt(entry: CharacterIndexEntry): Promise<string | undefined> {
  if (entry.personaPrompt) return entry.personaPrompt;
  const record = readShared(CHARACTER_INDEX_TOPIC);
  if (!record?.cid) return undefined;
  try {
    await ensureMistNode();
    const raw = await storage_get(record.cid);
    const text = new TextDecoder().decode(new Uint8Array(raw));
    const parsed: unknown = JSON.parse(text);
    const list = extractCharacterIndexList(parsed);
    if (!list) return undefined;
    for (const rawEntry of list) {
      const full = toEntry(rawEntry);
      if (full && full.id === entry.id) return full.personaPrompt;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

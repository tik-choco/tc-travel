// Fully automatic photo + card -> drive export: every photo (room + local,
// own and peers') and every card (received + your own) lands in the shared
// "TC Travel" drive folder without a manual save button anywhere in the UI.
// Driven from app.tsx off the reactive album/card/profile state; this module
// only decides WHAT to (re-)export and serializes/coalesces concurrent runs
// — the actual writes go through export.ts's own serialized queue.
import { ensureMistNode } from "../mistNode";
import { exportPhotoToDrive, isPhotoExported } from "./export";
import { sha256Hex } from "./crypto";
import { saveCardToDrive, type CardForExport } from "../../components/post/cardDrive";
import { albumPhotosSnapshot, getAlbumPhotoBytes } from "../memories";
import { getCards } from "../cards";
import { getProfile } from "../personal";

const STATE_KEY = "tc-travel:driveAutoExport";
const DEBOUNCE_MS = 700;

interface AutoExportState {
  /** cardId -> sha256 of the content it was last exported with, so re-syncing
   *  a card whose content hasn't changed is a no-op — otherwise every sync
   *  pass would bump its FileRecord version for nothing (photos don't need
   *  this: their content never changes after capture, so isPhotoExported's
   *  plain existence check is enough). */
  cardHashes: Record<string, string>;
}

function loadState(): AutoExportState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { cardHashes: {} };
    const parsed = JSON.parse(raw) as Partial<AutoExportState> | null;
    const cardHashes = parsed?.cardHashes;
    return { cardHashes: cardHashes && typeof cardHashes === "object" ? cardHashes : {} };
  } catch {
    return { cardHashes: {} };
  }
}

function saveState(state: AutoExportState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("tc-travel: failed to persist driveAutoExport state", err);
  }
}

type CardContent = Pick<CardForExport, "id" | "name" | "avatarEmoji" | "color" | "message">;

/** Stable content key for a card's visible fields. Deliberately excludes
 *  `at`/`receivedAt` — those are mint/receipt timestamps, not content a
 *  viewer would see change, and including them would defeat the hash gate
 *  (the own card's `at` is minted fresh on every sync pass). */
export function cardContentKey(card: CardContent): string {
  return JSON.stringify([card.id, card.name, card.avatarEmoji, card.color, card.message]);
}

const encoder = new TextEncoder();

function cardContentHash(card: CardContent): Promise<string> {
  return sha256Hex(encoder.encode(cardContentKey(card)));
}

/** Pure gate decision, exported for unit testing without localStorage/crypto:
 *  true iff the freshly computed hash differs from what's on record (or
 *  nothing is on record yet). */
export function shouldExportCard(recordedHash: string | undefined, freshHash: string): boolean {
  return recordedHash !== freshHash;
}

async function syncPhotos(): Promise<void> {
  const photos = albumPhotosSnapshot();
  for (const photo of photos) {
    if (isPhotoExported(photo.id)) continue;
    try {
      const bytes = await getAlbumPhotoBytes(photo);
      if (!bytes) continue; // not resolvable yet (e.g. a peer's bytes not synced) — retried next pass
      await exportPhotoToDrive({ photoId: photo.id, bytes, caption: photo.caption ?? "", at: photo.at });
    } catch (err) {
      console.warn("tc-travel: auto drive export failed (photo)", photo.id, err);
    }
  }
}

async function syncOneCard(card: CardForExport, state: AutoExportState): Promise<AutoExportState> {
  try {
    const freshHash = await cardContentHash(card);
    if (!shouldExportCard(state.cardHashes[card.id], freshHash)) return state;
    await saveCardToDrive(card);
    return { ...state, cardHashes: { ...state.cardHashes, [card.id]: freshHash } };
  } catch (err) {
    console.warn("tc-travel: auto drive export failed (card)", card.id, err);
    return state; // no hash recorded — retried next pass
  }
}

function ownCard(): CardForExport {
  const profile = getProfile();
  return {
    id: profile.id,
    name: profile.name,
    avatarEmoji: profile.avatarEmoji,
    color: profile.color,
    message: profile.cardMessage ?? "",
    at: Date.now(),
  };
}

async function syncCards(): Promise<void> {
  let state = loadState();
  const before = state;

  state = await syncOneCard(ownCard(), state);
  for (const card of getCards()) {
    state = await syncOneCard(
      {
        id: card.id,
        name: card.name,
        avatarEmoji: card.avatarEmoji,
        color: card.color,
        message: card.message,
        at: card.receivedAt ?? card.at,
      },
      state,
    );
  }

  if (state !== before) saveState(state);
}

/** One full backlog pass: every unexported photo, then every card whose
 *  content hash has changed since it was last exported. Per-item failures
 *  are swallowed (see syncPhotos/syncOneCard) so one bad photo/card never
 *  blocks the rest — nothing is marked exported/hashed on failure, so the
 *  next call retries it naturally. */
export async function syncDriveExports(): Promise<void> {
  try {
    await ensureMistNode();
  } catch (err) {
    console.warn("tc-travel: drive auto-export skipped (mist node unavailable)", err);
    return;
  }
  await syncPhotos();
  await syncCards();
}

/** Wraps an async function so overlapping invocations collapse: a call that
 *  arrives while one is already running doesn't start a second one in
 *  parallel — it just flags that another pass is needed once the current one
 *  finishes, and exactly one extra pass runs no matter how many calls piled
 *  up in the meantime. Exported for unit testing in isolation. */
export function singleFlight(fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  let dirty = false;
  return async function trigger(): Promise<void> {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        await fn();
      } while (dirty);
    } finally {
      running = false;
    }
  };
}

const runSync = singleFlight(syncDriveExports);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced external trigger — call this from wherever photos/cards/profile
 *  change (see app.tsx). Coalesces bursts (e.g. adding several photos back
 *  to back) into one sync pass instead of one per item, and re-publishing
 *  the folder bundle once instead of per photo. */
export function scheduleDriveAutoExport(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync();
  }, DEBOUNCE_MS);
}

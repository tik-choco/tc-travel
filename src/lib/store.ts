// Typed accessors + hooks over the room Y.Doc (see docs/DESIGN.md §Data
// model): `meta` (Y.Map), `members` (Y.Map<id, Member>), `photos`/`diary`/
// `pins` (Y.Array). Also owns room lifecycle (create/join/leave), building
// on collab.ts's transport-only CollabSession.
//
// Reactivity: every hook subscribes to one shared `notify()` pub/sub set,
// fed by CollabSession's onStatusChange/onDocChange/onPeersChange
// callbacks. onDocChange fires for *any* mutation anywhere in the Y.Doc
// (Yjs's 'update' event is doc-wide, not per shared-type), so all hooks
// re-render together on any change — a little coarser than per-array
// observers, but correct, simple, and plenty fast at meetup scale (dozens
// of members/photos/entries/pins).
import { useEffect, useState } from "preact/hooks";
import { storage_add, storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";
import { CollabSession, isValidRoomId, type PeerInfo, type CompanionPose } from "./collab";
export type { CompanionPose };
import { getProfile, recordJourney, touchJoinedRoom } from "./personal";
import type { DiaryEntry, EncounterPin, Member, Photo, RoomMeta } from "./types";

// --- session singleton ------------------------------------------------

interface ActiveSession {
  session: CollabSession;
  roomId: string;
  connected: boolean;
  peers: PeerInfo[];
}

let active: ActiveSession | null = null;
const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((fn) => fn());
}

function useStoreVersion(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
}

/** Decodes a data URL (as stored in Profile.avatarImage) back to raw bytes for upload. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Uploads avatar JPEG bytes to mist storage and sets avatarCid on the local
 *  member record, if a room is active. Returns the new cid, or null when not
 *  in a room. Called by avatar.ts on every profile-avatar change and by
 *  openSession() on join/create (see there for why re-upload-on-join is safe). */
export async function setMemberAvatarBytes(bytes: Uint8Array): Promise<string | null> {
  const record = active;
  if (!record) return null;
  await ensureMistNode();
  const cid = await storage_add(`avatar-${crypto.randomUUID()}.jpg`, bytes);
  // The user may have left or switched rooms while the upload was in flight;
  // `active` is module-global mutable state, so never stamp whatever room is
  // active NOW with a cid that was uploaded for the room active back THEN.
  if (active !== record) return null;
  const profile = getProfile();
  const session = record.session;
  let vrmCid: string | undefined;
  session.transact(() => {
    const members = session.doc.getMap<Member>("members");
    const existing = members.get(profile.id);
    if (existing) {
      vrmCid = existing.vrmCid;
      members.set(profile.id, { ...existing, avatarCid: cid });
    }
  });
  // setUser replaces the whole awareness identity, so vrmCid must be carried
  // through here (as setMemberVrmBytes carries avatarCid) or it would vanish
  // from the local awareness state.
  session.setUser({ memberId: profile.id, name: profile.name, color: profile.color, avatarEmoji: profile.avatarEmoji, avatarCid: cid, vrmCid });
  return cid;
}

/** Removes avatarCid from the local member record, if a room is active. */
export function clearMemberAvatarCid(): void {
  if (!active) return;
  const session = active.session;
  const profile = getProfile();
  let vrmCid: string | undefined;
  session.transact(() => {
    const members = session.doc.getMap<Member>("members");
    const existing = members.get(profile.id);
    if (!existing || existing.avatarCid === undefined) return;
    vrmCid = existing.vrmCid;
    const { avatarCid: _drop, ...rest } = existing;
    members.set(profile.id, rest as Member);
  });
  // "" (not undefined) is the explicit "cleared" sentinel: awareness states are
  // JSON-encoded, so an undefined field is dropped and becomes indistinguishable
  // from "never sent one" on the receiving side. useMembers treats "" as cleared.
  // vrmCid is carried through since setUser replaces the whole identity.
  session.setUser({ memberId: profile.id, name: profile.name, color: profile.color, avatarEmoji: profile.avatarEmoji, avatarCid: "", vrmCid });
}

/** Publishes the AR companion's VRM to shared storage and mirrors the cid onto
 *  the members Y.Map and awareness. Same structure as setMemberAvatarBytes.
 *  storage_add is content-addressed, so re-publishing the same bytes is idempotent. */
export async function setMemberVrmBytes(bytes: Uint8Array): Promise<void> {
  const record = active;
  if (!record) return;
  const profile = getProfile();
  await ensureMistNode();
  const cid = await storage_add(`companion-${profile.id}.vrm`, bytes);
  // Mirrors setMemberAvatarBytes's stale-upload guard: the user may have left
  // or switched rooms while the upload was in flight.
  if (active !== record) return;
  const session = record.session;
  let avatarCid: string | undefined;
  session.transact(() => {
    const members = session.doc.getMap<Member>("members");
    const existing = members.get(profile.id);
    if (existing) {
      avatarCid = existing.avatarCid;
      members.set(profile.id, { ...existing, vrmCid: cid });
    }
  });
  // setUser replaces the whole awareness identity, so avatarCid must be
  // carried through here or this call would clobber it.
  session.setUser({ memberId: profile.id, name: profile.name, color: profile.color, avatarEmoji: profile.avatarEmoji, avatarCid, vrmCid: cid });
}

/** Sends this session's companion pose (no-op if not in a room). */
export function sendCompanionPose(pose: Omit<CompanionPose, "memberId" | "t">): void {
  active?.session.sendPose(pose);
}

/** Subscribes to peers' companion poses (immediate no-op unsubscribe if not in a room). */
export function onCompanionPose(listener: (pose: CompanionPose) => void): () => void {
  if (!active) return () => {};
  return active.session.onPose(listener);
}

/** memberId -> vrmCid for all members with a published companion VRM ("" and
 *  undefined excluded). Same three-way merge convention as useMembers. */
export function useMemberVrmCids(): Map<string, string> {
  useStoreVersion();
  const result = new Map<string, string>();
  if (!active) return result;
  const membersMap = active.session.doc.getMap<Member>("members");
  membersMap.forEach((member, id) => {
    if (member.vrmCid) result.set(id, member.vrmCid);
  });
  for (const peer of active.peers) {
    if (!peer.memberId) continue;
    if (peer.vrmCid === "") {
      result.delete(peer.memberId);
    } else if (peer.vrmCid) {
      result.set(peer.memberId, peer.vrmCid);
    }
  }
  return result;
}

function mirrorJourney(roomId: string): void {
  if (!active || active.roomId !== roomId) return;
  const doc = active.session.doc;
  recordJourney(roomId, {
    pins: doc.getArray<EncounterPin>("pins").toArray(),
    photos: doc.getArray<Photo>("photos").toArray(),
    diary: doc.getArray<DiaryEntry>("diary").toArray(),
  });
}

async function openSession(roomId: string, seed?: { name: string; emoji: string }): Promise<void> {
  if (active) {
    active.session.destroy();
    active = null;
  }
  const profile = getProfile();
  const record: ActiveSession = {
    // placeholder swapped in immediately below; CollabSession's callbacks
    // need `record` to already exist so they can mutate it in place.
    session: undefined as unknown as CollabSession,
    roomId,
    connected: false,
    peers: [],
  };
  const session = new CollabSession(
    { memberId: profile.id, name: profile.name, color: profile.color, avatarEmoji: profile.avatarEmoji },
    {
      onStatusChange: (status) => {
        record.connected = status === "connected";
        notify();
      },
      onDocChange: () => {
        notify();
        mirrorJourney(roomId);
      },
      onPeersChange: (peers) => {
        record.peers = peers;
        notify();
      },
    },
  );
  record.session = session;
  active = record;
  notify();

  await session.join(roomId);

  session.transact(() => {
    const metaMap = session.doc.getMap<string | number>("meta");
    if (seed && !metaMap.has("name")) {
      metaMap.set("name", seed.name);
      metaMap.set("emoji", seed.emoji);
      metaMap.set("createdAt", Date.now());
    }
    const members = session.doc.getMap<Member>("members");
    if (!members.has(profile.id)) {
      members.set(profile.id, {
        id: profile.id,
        name: profile.name,
        color: profile.color,
        avatarEmoji: profile.avatarEmoji,
        joinedAt: Date.now(),
      });
    }
  });

  // Re-upload the profile avatar into this room and stamp the member record
  // with the fresh cid. Done after (not during) the transact above so a
  // slow/failed upload never blocks the member record from existing; failure
  // here is non-fatal to joining the room, just logged.
  if (profile.avatarImage) {
    try {
      await setMemberAvatarBytes(dataUrlToBytes(profile.avatarImage));
    } catch (err) {
      console.error("tc-travel: failed to upload avatar on join", err);
    }
  } else {
    // The avatar may have been removed while outside this room — strip any
    // stale cid left on our member record from a previous visit.
    clearMemberAvatarCid();
  }

  const roomName = seed?.name ?? (session.doc.getMap<string>("meta").get("name") ?? "");
  touchJoinedRoom(roomId, roomName);
  mirrorJourney(roomId);
}

export async function createRoom(name: string, emoji: string): Promise<string> {
  const roomId = crypto.randomUUID();
  await openSession(roomId, { name, emoji });
  return roomId;
}

export async function joinRoom(roomId: string): Promise<void> {
  if (!isValidRoomId(roomId)) throw new Error(`Invalid room id: ${roomId}`);
  await openSession(roomId);
}

export async function leaveRoom(): Promise<void> {
  if (!active) return;
  active.session.destroy();
  active = null;
  notify();
}

export function useSession(): { roomId: string; meta: RoomMeta; connected: boolean } | null {
  useStoreVersion();
  if (!active) return null;
  const metaMap = active.session.doc.getMap<string | number>("meta");
  const meta: RoomMeta = {
    name: (metaMap.get("name") as string) ?? "",
    createdAt: (metaMap.get("createdAt") as number) ?? 0,
    emoji: (metaMap.get("emoji") as string) ?? "",
  };
  return { roomId: active.roomId, meta, connected: active.connected };
}

// --- members ---------------------------------------------------------

export function useMembers(): Member[] {
  useStoreVersion();
  if (!active) return [];
  const membersMap = active.session.doc.getMap<Member>("members");
  const byId = new Map<string, Member>();
  membersMap.forEach((member, id) => byId.set(id, member));
  // Live awareness overlay: a peer who just connected may not have their
  // `members` Y.Map entry synced yet (it's written in a transaction right
  // after join(), which can race the first awareness broadcast), so surface
  // them from presence too rather than waiting for the CRDT update.
  // Keyed by the profile-level memberId (carried in awareness), which is the
  // same id the members Y.Map uses — NOT the transport-level peerId/nodeId,
  // which is a different uuid and would duplicate every peer.
  for (const peer of active.peers) {
    if (!peer.memberId) continue;
    const existing = byId.get(peer.memberId);
    byId.set(peer.memberId, {
      id: peer.memberId,
      name: peer.name,
      color: peer.color,
      avatarEmoji: peer.avatarEmoji || existing?.avatarEmoji || "\u{1F9ED}",
      // Three-way merge: "" is the explicit "just cleared" sentinel (awareness
      // beats the slower Y.Map sync, so honoring it avoids showing a stale
      // avatar); an ABSENT value means an older peer build or a mid-upload
      // window, where the members Y.Map entry is the best available answer.
      avatarCid: peer.avatarCid === "" ? undefined : peer.avatarCid || existing?.avatarCid,
      joinedAt: existing?.joinedAt ?? Date.now(),
    });
  }
  return Array.from(byId.values());
}

// --- photos ------------------------------------------------------------

export function usePhotos(): Photo[] {
  useStoreVersion();
  if (!active) return [];
  return active.session.doc.getArray<Photo>("photos").toArray().slice().sort((a, b) => b.at - a.at);
}

export async function addPhoto(bytes: Uint8Array, meta: Omit<Photo, "id" | "cid" | "by" | "at">): Promise<void> {
  if (!active) throw new Error("Not in a room");
  const profile = getProfile();
  await ensureMistNode();
  const cid = await storage_add(`photo-${crypto.randomUUID()}.jpg`, bytes);
  const photo: Photo = { id: crypto.randomUUID(), cid, by: profile.id, at: Date.now(), ...meta };
  const session = active.session;
  session.transact(() => {
    session.doc.getArray<Photo>("photos").push([photo]);
  });
}

export function removePhoto(id: string): void {
  if (!active) return;
  const session = active.session;
  session.transact(() => {
    const arr = session.doc.getArray<Photo>("photos");
    const idx = arr.toArray().findIndex((p) => p.id === id);
    if (idx >= 0) arr.delete(idx, 1);
  });
}

const photoUrlCache = new Map<string, string>();
const RETRY_DELAYS_MS = [0, 1000, 3000, 9000]; // first attempt immediate, then 1s/3s/9s backoff

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** cid -> ObjectURL, cached module-wide and retried with backoff (peer may not be reachable right after joining). */
export function usePhotoUrl(photo: Photo | null): string | null {
  const [url, setUrl] = useState<string | null>(photo ? (photoUrlCache.get(photo.cid) ?? null) : null);

  useEffect(() => {
    if (!photo) {
      setUrl(null);
      return;
    }
    const cached = photoUrlCache.get(photo.cid);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    setUrl(null);
    void (async () => {
      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) await sleep(delay);
        if (cancelled) return;
        try {
          await ensureMistNode();
          const bytes = await storage_get(photo.cid);
          // Re-wrap: mistlib's Uint8Array return type isn't pinned to a
          // plain ArrayBuffer (vs. ArrayBufferLike/SharedArrayBuffer),
          // which BlobPart requires.
          const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
          photoUrlCache.set(photo.cid, objectUrl);
          if (!cancelled) setUrl(objectUrl);
          return;
        } catch {
          // retry per RETRY_DELAYS_MS; give up silently after the last attempt
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo?.cid]);

  return url;
}

// --- diary ---------------------------------------------------------------

export function useDiary(): DiaryEntry[] {
  useStoreVersion();
  if (!active) return [];
  return active.session.doc.getArray<DiaryEntry>("diary").toArray().slice().sort((a, b) => b.at - a.at);
}

export function addDiaryEntry(e: Omit<DiaryEntry, "id" | "by" | "at">): void {
  if (!active) return;
  const profile = getProfile();
  const entry: DiaryEntry = { id: crypto.randomUUID(), by: profile.id, at: Date.now(), ...e };
  const session = active.session;
  session.transact(() => {
    session.doc.getArray<DiaryEntry>("diary").push([entry]);
  });
}

export function updateDiaryEntry(id: string, patch: Partial<Pick<DiaryEntry, "title" | "text" | "mood">>): void {
  if (!active) return;
  const session = active.session;
  session.transact(() => {
    const arr = session.doc.getArray<DiaryEntry>("diary");
    const list = arr.toArray();
    const idx = list.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const updated: DiaryEntry = { ...list[idx], ...patch };
    arr.delete(idx, 1);
    arr.insert(idx, [updated]);
  });
}

export function removeDiaryEntry(id: string): void {
  if (!active) return;
  const session = active.session;
  session.transact(() => {
    const arr = session.doc.getArray<DiaryEntry>("diary");
    const idx = arr.toArray().findIndex((d) => d.id === id);
    if (idx >= 0) arr.delete(idx, 1);
  });
}

// --- pins ------------------------------------------------------------------

export function usePins(): EncounterPin[] {
  useStoreVersion();
  if (!active) return [];
  return active.session.doc.getArray<EncounterPin>("pins").toArray();
}

export function addPin(p: Omit<EncounterPin, "id" | "by" | "at">): void {
  if (!active) return;
  const profile = getProfile();
  const pin: EncounterPin = { id: crypto.randomUUID(), by: profile.id, at: Date.now(), ...p };
  const session = active.session;
  session.transact(() => {
    session.doc.getArray<EncounterPin>("pins").push([pin]);
  });
}

export function removePin(id: string): void {
  if (!active) return;
  const session = active.session;
  session.transact(() => {
    const arr = session.doc.getArray<EncounterPin>("pins");
    const idx = arr.toArray().findIndex((p) => p.id === id);
    if (idx >= 0) arr.delete(idx, 1);
  });
}

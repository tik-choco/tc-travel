// Room lifecycle + Y.Doc <-> mistlib bridge. mistlib itself is just a raw-
// message pipe — this module layers y-protocols' sync/awareness protocols on
// top, each message tagged with a 1-byte type prefix so both protocols can
// share mistlib's single onRawMessage channel. Adapted from tc-note's
// src/lib/collab.ts; the note-specific block/order/cursor model is dropped
// since the Y.Doc's actual shape (meta/members/photos/diary/pins) is owned
// by store.ts — this class only wires the transport.
//
// mistlib exposes only one onEvent slot per node, and that node is shared
// with other consumers on this page — the AI companion client joins its own
// room on the same node (SPEC-15 multi-room support). So this module
// registers through mistNode.ts's fan-out dispatcher (addNodeEventHandler)
// rather than claiming node.onEvent directly, and still dispatches on
// eventType itself once its own handler fires. And because a plain
// sendMessage/leaveRoom on the shared node is unscoped (it would hit every
// room the node has joined), every send and the eventual leave here are
// scoped to this.roomId so collab's Yjs traffic never leaks into another
// room sharing the node.

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  MistNode,
  EVENT_RAW,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  DELIVERY_RELIABLE,
  DELIVERY_UNRELIABLE,
} from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode, currentNodeId, addNodeEventHandler } from "./mistNode";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
export const MSG_POSE = 2;

/** 共有仮想ステージ上のコンパニオン姿勢。数値は有限・|値|<=100 に clamp。 */
export interface CompanionPose {
  memberId: string; // Member.id (安定 id)
  x: number; y: number; z: number; // scene 座標
  ry: number;  // yaw ラジアン
  s: number;   // uniform scale (0.1..10 に clamp)
  t: number;   // 送信側 epoch ms(古い順序外パケットの破棄用)
}

// Clamp bounds for received CompanionPose fields — an UNRELIABLE, unauthenticated
// (P2P) channel, so a corrupted/adversarial peer payload must not be able to
// place a companion arbitrarily far off the shared stage or scale it to zero/huge.
const POSE_POS_LIMIT = 100;
const POSE_SCALE_MIN = 0.1;
const POSE_SCALE_MAX = 10;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Validates + clamps a JSON-decoded pose payload from the wire. Returns null
// for anything that doesn't shape-check (missing/wrong-typed field, non-finite
// number) rather than throwing — see handlePoseMessage's defensive-decode note.
function parsePose(value: unknown): CompanionPose | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const { memberId, x, y, z, ry, s, t } = v;
  // Length-capped: real memberIds are 36-char UUIDs; anything oversized is a
  // peer fabricating ids, and every novel id costs receiver-side state.
  if (typeof memberId !== "string" || !memberId || memberId.length > 64) return null;
  for (const n of [x, y, z, ry, s, t]) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
  }
  return {
    memberId,
    x: clamp(x as number, -POSE_POS_LIMIT, POSE_POS_LIMIT),
    y: clamp(y as number, -POSE_POS_LIMIT, POSE_POS_LIMIT),
    z: clamp(z as number, -POSE_POS_LIMIT, POSE_POS_LIMIT),
    ry: ry as number,
    s: clamp(s as number, POSE_SCALE_MIN, POSE_SCALE_MAX),
    t: t as number,
  };
}

// Tags updates originating from this session's own Yjs transactions, so the
// update-broadcast listener can tell them apart from updates applied while
// replaying a message that arrived over the network (which must not be
// re-broadcast, or peers would echo messages back and forth forever).
const LOCAL_ORIGIN = Symbol("collab-local");
// Tags updates/awareness changes applied while decoding a message that just
// arrived from a peer, so they're never mistaken for local edits and
// rebroadcast (which would echo every message around the room indefinitely).
const REMOTE_ORIGIN = Symbol("collab-remote");

export interface CollabUser {
  /** Stable profile id (personal.ts) — matches the `members` Y.Map key, unlike the transport-level nodeId. */
  memberId: string;
  name: string;
  color: string;
  avatarEmoji: string;
  /** mist storage cid of this user's avatar portrait, if any (see avatar.ts). */
  avatarCid?: string;
  /** mist storage cid of this user's AR companion VRM, if any (see store.ts's setMemberVrmBytes). */
  vrmCid?: string;
}

export interface PeerInfo {
  clientId: number;
  peerId: string;
  memberId: string;
  name: string;
  color: string;
  avatarEmoji: string;
  avatarCid?: string;
  vrmCid?: string;
}

export type CollabStatus = "idle" | "connecting" | "connected" | "error";

// Room ids are either generated (crypto.randomUUID()) or typed/pasted in by
// hand (QR fallback / manual join) — keep the accepted shape narrow so
// obviously-garbled input is rejected before it ever reaches mistlib's
// joinRoom().
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}

// Defensive clamps applied to any identity data that can come from outside
// this session's own control — a remote peer's awareness state. This is
// P2P, not a server boundary, but a corrupted/adversarial value here could
// still blow up layout (an unbounded name) or fail silently in a `style`
// binding (a non-color string), so both are normalized to a safe fallback.
const NAME_MAX_LEN = 40;
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const FALLBACK_COLOR = "#888888";
const FALLBACK_EMOJI = "\u{1F9ED}"; // compass

export function clampUserName(name: string): string {
  const trimmed = name.trim().slice(0, NAME_MAX_LEN);
  return trimmed || "Anonymous";
}

export function normalizeColor(color: string): string {
  return COLOR_PATTERN.test(color) ? color : FALLBACK_COLOR;
}

export interface CollabCallbacks {
  onStatusChange?: (status: CollabStatus) => void;
  onPeersChange?: (peers: PeerInfo[]) => void;
  /** Fired after any doc mutation (local or remote) so the caller can re-derive its own state. */
  onDocChange?: () => void;
}

interface AwarenessState {
  peerId: string;
  memberId: string;
  name: string;
  color: string;
  avatarEmoji: string;
  avatarCid?: string;
  vrmCid?: string;
}

// How a CollabSession obtains the page's mistlib node — the real
// implementation adopts the one shared MistNode (see mistNode.ts). Overridable
// purely for tests, which simulate multiple independent peers within a single
// process and so need each simulated peer to have its own fake node.
export interface MistNodeAccess {
  ensure(): Promise<InstanceType<typeof MistNode>>;
  currentId(): string;
}

const defaultNodeAccess: MistNodeAccess = { ensure: ensureMistNode, currentId: currentNodeId };

// One CollabSession per open room. Owns the Y.Doc, awareness instance, and
// the mistlib node for the room; destroy() tears all of it down cleanly.
// The Y.Doc's shared types (meta/members/photos/diary/pins) are created and
// read by store.ts — this class never touches them by name.
export class CollabSession {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);

  private node: InstanceType<typeof MistNode> | null = null;
  private roomId: string | null = null;
  private status: CollabStatus = "idle";
  private disposed = false;
  private peerIdByClientId = new Map<number, string>();
  private unsubscribeEvents: (() => void) | null = null;
  private user: CollabUser;
  private readonly callbacks: CollabCallbacks;
  private readonly nodeAccess: MistNodeAccess;
  private poseListeners = new Set<(pose: CompanionPose) => void>();
  // Last accepted `t` per memberId — DELIVERY_UNRELIABLE gives no ordering
  // guarantee, so a packet older than the last one accepted for that member
  // is a stale reorder and must be dropped rather than snapping the
  // companion backwards.
  private lastPoseT = new Map<string, number>();

  constructor(user: CollabUser, callbacks: CollabCallbacks = {}, nodeAccess: MistNodeAccess = defaultNodeAccess) {
    this.user = user;
    this.nodeAccess = nodeAccess;
    this.callbacks = callbacks;
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("change", this.handleAwarenessChange);
  }

  get status_(): CollabStatus {
    return this.status;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  get localClientId(): number {
    return this.doc.clientID;
  }

  /** Participating only. JSON encode → MSG_POSE prefix → DELIVERY_UNRELIABLE
   *  broadcast(room scoped). throttle is the caller's responsibility. */
  sendPose(pose: Omit<CompanionPose, "memberId" | "t">): void {
    // Called from a 10Hz loop regardless of session state — silently
    // no-op rather than making every caller guard on join status.
    if (!this.node) return;
    const full: CompanionPose = { ...pose, memberId: this.user.memberId, t: Date.now() };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_POSE);
    encoding.writeUint8Array(encoder, new TextEncoder().encode(JSON.stringify(full)));
    this.node.sendMessage(null, encoding.toUint8Array(encoder), DELIVERY_UNRELIABLE, this.roomId ?? undefined);
  }

  /** Subscribes to incoming poses. Returns an unsubscribe function. Never delivers this session's own memberId's poses. */
  onPose(listener: (pose: CompanionPose) => void): () => void {
    this.poseListeners.add(listener);
    return () => {
      this.poseListeners.delete(listener);
    };
  }

  /** Runs `fn` as a local edit, so its resulting update gets broadcast to peers. */
  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL_ORIGIN);
  }

  /** Updates the local user's display identity live — peers see it on their next awareness sync. */
  setUser(user: CollabUser): void {
    this.user = user;
    const state = this.awareness.getLocalState() as AwarenessState | null;
    if (state) {
      this.awareness.setLocalState({
        ...state,
        name: user.name,
        color: user.color,
        avatarEmoji: user.avatarEmoji,
        avatarCid: user.avatarCid,
        vrmCid: user.vrmCid,
      });
    }
  }

  private setStatus(status: CollabStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    this.callbacks.onDocChange?.();
    if (origin === LOCAL_ORIGIN) this.broadcastUpdate(update);
  };

  private handleAwarenessChange = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    this.emitPeers();
    // Only broadcast changes we originated locally; changes applied while
    // decoding a remote awareness message must not be echoed back out.
    if (origin !== REMOTE_ORIGIN) {
      const changed = [...added, ...updated, ...removed];
      this.broadcastAwareness(changed);
    }
  };

  private emitPeers(): void {
    const peers: PeerInfo[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID) return;
      const s = state as Partial<AwarenessState>;
      peers.push({
        clientId,
        peerId: s.peerId ?? "",
        memberId: s.memberId ?? "",
        name: clampUserName(s.name ?? "Anonymous"),
        color: normalizeColor(s.color ?? FALLBACK_COLOR),
        avatarEmoji: s.avatarEmoji || FALLBACK_EMOJI,
        avatarCid: s.avatarCid || undefined,
        vrmCid: s.vrmCid || undefined,
      });
      if (s.peerId) this.peerIdByClientId.set(clientId, s.peerId);
    });
    this.callbacks.onPeersChange?.(peers);
  }

  private broadcastUpdate(update: Uint8Array): void {
    if (!this.node) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.node.sendMessage(null, encoding.toUint8Array(encoder), DELIVERY_RELIABLE, this.roomId ?? undefined);
  }

  private broadcastAwareness(clientIds: number[]): void {
    if (!this.node || clientIds.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.node.sendMessage(null, encoding.toUint8Array(encoder), DELIVERY_RELIABLE, this.roomId ?? undefined);
  }

  private sendSyncStep1(toId: string): void {
    if (!this.node) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.node.sendMessage(toId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE, this.roomId ?? undefined);
  }

  private sendFullAwareness(toId: string): void {
    if (!this.node) return;
    const clientIds = Array.from(this.awareness.getStates().keys());
    if (clientIds.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.node.sendMessage(toId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE, this.roomId ?? undefined);
  }

  private handleRawMessage(fromId: string, payload: Uint8Array): void {
    const decoder = decoding.createDecoder(payload);
    const msgType = decoding.readVarUint(decoder);

    if (msgType === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      // Tag as REMOTE_ORIGIN, not LOCAL_ORIGIN — this applies an update that
      // arrived from a peer, and handleDocUpdate must not rebroadcast it
      // (rebroadcasting an already-broadcast update is what causes an
      // unbounded echo loop with 3+ peers).
      const replyType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE_ORIGIN);
      // readSyncMessage only writes a reply for step1 (responding with
      // step2); step2/update messages produce no reply, so skip sending an
      // empty frame.
      if (replyType === syncProtocol.messageYjsSyncStep1) {
        this.node?.sendMessage(fromId, encoding.toUint8Array(encoder), DELIVERY_RELIABLE, this.roomId ?? undefined);
      }
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, REMOTE_ORIGIN);
    } else if (msgType === MSG_POSE) {
      this.handlePoseMessage(decoder);
    }
  }

  // Defensive: this is an unauthenticated P2P channel, and it's sent at
  // 10Hz, so malformed/adversarial/stale payloads are dropped silently
  // (no console — would spam at that rate) rather than throwing.
  private handlePoseMessage(decoder: decoding.Decoder): void {
    const bytes = decoding.readTailAsUint8Array(decoder);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return;
    }
    const pose = parsePose(parsed);
    if (!pose) return;
    if (pose.memberId === this.user.memberId) return; // never deliver our own echoed pose
    const lastT = this.lastPoseT.get(pose.memberId);
    if (lastT !== undefined && pose.t <= lastT) return; // stale/out-of-order UNRELIABLE packet
    // Bound the per-member tracking map: a peer flooding fabricated ids must
    // not grow it without limit. 256 far exceeds any real meetup roster; when
    // full, packets from further NEW ids are dropped (known ids keep working).
    if (lastT === undefined && this.lastPoseT.size >= 256) return;
    this.lastPoseT.set(pose.memberId, pose.t);
    this.poseListeners.forEach((listener) => listener(pose));
  }

  private handlePeerDisconnected(peerId: string): void {
    const staleClientIds = Array.from(this.peerIdByClientId.entries())
      .filter(([, pid]) => pid === peerId)
      .map(([clientId]) => clientId);
    if (staleClientIds.length === 0) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, staleClientIds, REMOTE_ORIGIN);
    staleClientIds.forEach((id) => this.peerIdByClientId.delete(id));
  }

  async join(roomId: string): Promise<void> {
    this.setStatus("connecting");
    try {
      // The page has exactly one MistNode, shared with photo storage (see
      // mistNode.ts) — this session adopts it rather than creating its own,
      // so a room join never races storage's use of the same underlying
      // engine for the "one active MistNode per page" slot.
      const node = await this.nodeAccess.ensure();
      const nodeId = this.nodeAccess.currentId();
      if (this.disposed) {
        // The session was torn down (user left, or joined elsewhere) while
        // the node access was in flight. The node is shared with storage
        // and other sessions, so — unlike when this session owned a
        // dedicated node — leave it running rather than tearing it down.
        return;
      }
      this.node = node;
      this.roomId = roomId;

      this.unsubscribeEvents = addNodeEventHandler((eventType, fromId, payload, roomId) => {
        // Guard against a callback firing after this session moved on
        // (destroyed, or joined a different room/node) — the event slot is
        // now a shared fan-out dispatcher (mistNode.ts) rather than
        // exclusively owned by this session, so a stale handler can linger
        // until unsubscribeEvents() runs in leave().
        if (this.disposed || this.node !== node) return;
        // Ignore events tagged for a different room sharing this node
        // (e.g. the AI companion's); events with no room attached are
        // processed as before, for backward compatibility.
        if (roomId !== undefined && roomId !== this.roomId) return;
        if (eventType === EVENT_RAW) {
          const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
          this.handleRawMessage(fromId, bytes);
        } else if (eventType === EVENT_PEER_CONNECTED) {
          this.sendSyncStep1(fromId);
          this.sendFullAwareness(fromId);
        } else if (eventType === EVENT_PEER_DISCONNECTED) {
          this.handlePeerDisconnected(fromId);
        }
      });

      this.awareness.setLocalState({
        peerId: nodeId,
        memberId: this.user.memberId,
        name: this.user.name,
        color: this.user.color,
        avatarEmoji: this.user.avatarEmoji,
        avatarCid: this.user.avatarCid,
        vrmCid: this.user.vrmCid,
      } satisfies AwarenessState);

      node.joinRoom(roomId);
      this.setStatus("connected");
    } catch (err) {
      this.setStatus("error");
      throw err;
    }
  }

  leave(): void {
    if (this.node) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], LOCAL_ORIGIN);
      // Scoped to this.roomId: the unscoped leaveRoom() form would tear down
      // the whole shared node, decommissioning any other room on it (e.g.
      // the AI companion's). This leaves the node itself initialized.
      this.node.leaveRoom(this.roomId ?? undefined);
      this.node = null;
    }
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.roomId = null;
    this.peerIdByClientId.clear();
    this.poseListeners.clear();
    this.lastPoseT.clear();
    this.setStatus("idle");
  }

  destroy(): void {
    this.leave();
    this.disposed = true;
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("change", this.handleAwarenessChange);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

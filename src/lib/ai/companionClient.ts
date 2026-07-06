// Wires the vendored mistai ConsumerService/VoiceConsumerService onto
// tc-travel's single shared MistNode (see ../mistNode.ts), instead of the
// upstream mistai ConsumerClient's private Network — tc-travel's "one node
// per page" model means every consumer of mist has to share the same node
// and multiplex its single event slot via addNodeEventHandler.
//
// Provider-discovery logic (provider_hello / consumer_hello handshake,
// provider-wait timeout, peer-disconnect -> searching + rejectAll) is ported
// from mistai/src/client.ts's ConsumerClient.createSession/waitForProvider,
// adapted to room-scoped sendMessage/joinRoom/leaveRoom (SPEC-15 multi-room)
// instead of a dedicated Network.
import {
  ConsumerService,
  MistaiError,
  VoiceConsumerService,
  decode,
  encode,
  type ChatMessage,
  type ProtocolMessage,
  type SendFn,
} from "../../vendor/mistai";
import { EVENT_PEER_DISCONNECTED, EVENT_RAW, DELIVERY_RELIABLE } from "../../vendor/mistlib/wrappers/web/index.js";
import { addNodeEventHandler, ensureMistNode, type NodeEventHandler } from "../mistNode";

// Ported from mistai/src/client.ts's DEFAULT_PROVIDER_WAIT_TIMEOUT_MS.
const PROVIDER_WAIT_TIMEOUT_MS = 10_000;

export type CompanionPhase = "idle" | "joining" | "searching" | "connected" | "error";

export interface CompanionStatus {
  phase: CompanionPhase;
  providerId?: string; // connected 時
  models?: string[]; // provider_hello.models
  message?: string; // error 時(英語生文。表示側で i18n コードマップ優先)
  code?: string; // MistaiErrorCode("PROVIDER_NOT_FOUND" | "JOIN_FAILED" 等)
}

export type CompanionStatusListener = (status: CompanionStatus) => void;

/** Minimal surface of the shared MistNode this client needs — kept narrow so
 *  tests can inject a fake without depending on the real mistlib wrapper. */
export interface CompanionMistNode {
  joinRoom(roomId: string): void;
  leaveRoom(roomId: string): void;
  sendMessage(toId: string | null, payload: Uint8Array, delivery: number, roomId: string): void;
}

/** How CompanionClient obtains the page's shared node and taps into its
 *  fan-out event dispatcher — overridable purely for tests, which use a fake
 *  node + a manually-triggerable handler instead of the real mistlib wrapper.
 *  Mirrors collab.ts's MistNodeAccess seam. */
export interface CompanionNodeAccess {
  ensure(): Promise<CompanionMistNode>;
  addEventHandler(handler: NodeEventHandler): () => void;
}

const defaultNodeAccess: CompanionNodeAccess = {
  ensure: ensureMistNode,
  addEventHandler: addNodeEventHandler,
};

interface ProviderWaiter {
  resolve: (providerId: string) => void;
  reject: (err: Error) => void;
}

export class CompanionClient {
  private readonly nodeAccess: CompanionNodeAccess;
  private readonly listeners = new Set<CompanionStatusListener>();
  private currentStatus: CompanionStatus = { phase: "idle" };

  private node: CompanionMistNode | null = null;
  private unsubscribe: (() => void) | null = null;
  private aiRoomId: string | null = null;
  private connectGeneration = 0;

  private consumer: ConsumerService | null = null;
  private voiceConsumer: VoiceConsumerService | null = null;
  private providerId: string | null = null;
  private providerWaiters: ProviderWaiter[] = [];
  private providerTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(nodeAccess: CompanionNodeAccess = defaultNodeAccess) {
    this.nodeAccess = nodeAccess;
  }

  get status(): CompanionStatus {
    return this.currentStatus;
  }

  /** Subscribes to status changes. Returns an unsubscribe function. */
  onStatusChange(listener: CompanionStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(status: CompanionStatus): void {
    this.currentStatus = status;
    this.listeners.forEach((listener) => listener(status));
  }

  private readonly send: SendFn = (toId, msg) => {
    if (!this.node || !this.aiRoomId) return;
    this.node.sendMessage(toId, encode(msg), DELIVERY_RELIABLE, this.aiRoomId);
  };

  /**
   * Eager, never throws. No-op if already connecting/connected to `roomId`;
   * switches rooms (tearing down the old one first) otherwise.
   */
  connect(roomId: string): void {
    const trimmed = roomId.trim();
    if (!trimmed) return;
    if (this.aiRoomId === trimmed) return;
    if (this.aiRoomId !== null) this.teardown();

    this.aiRoomId = trimmed;
    this.consumer = new ConsumerService(this.send);
    this.voiceConsumer = new VoiceConsumerService(this.send);
    const generation = ++this.connectGeneration;
    this.emit({ phase: "joining" });

    this.doConnect(trimmed, generation).catch((err: unknown) => {
      if (generation !== this.connectGeneration) return;
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ phase: "error", message, code: "JOIN_FAILED" });
    });
  }

  private async doConnect(roomId: string, generation: number): Promise<void> {
    const node = await this.nodeAccess.ensure();
    if (generation !== this.connectGeneration) return; // superseded by a later connect()/disconnect()

    this.node = node;
    this.unsubscribe = this.nodeAccess.addEventHandler(this.handleNodeEvent);
    node.joinRoom(roomId);
    this.emit({ phase: "searching" });
    // Announce presence to anyone already in the room so a provider can pick
    // us up even before our first request.
    node.sendMessage(null, encode({ v: 1, type: "consumer_hello" }), DELIVERY_RELIABLE, roomId);
    this.startProviderTimeout(generation);
  }

  private startProviderTimeout(generation: number): void {
    if (this.providerTimeoutTimer !== null) clearTimeout(this.providerTimeoutTimer);
    this.providerTimeoutTimer = setTimeout(() => {
      this.providerTimeoutTimer = null;
      if (generation !== this.connectGeneration || this.providerId) return;
      const err = new MistaiError("PROVIDER_NOT_FOUND", "No provider found on the AI companion network.");
      this.rejectProviderWaiters(err);
      this.emit({ phase: "error", message: err.message, code: err.code });
    }, PROVIDER_WAIT_TIMEOUT_MS);
  }

  private rejectProviderWaiters(err: Error): void {
    const waiters = this.providerWaiters.splice(0);
    waiters.forEach((waiter) => waiter.reject(err));
  }

  private handleNodeEvent: NodeEventHandler = (eventType, fromId, payload, roomId) => {
    if (!this.aiRoomId) return;
    // Per-contract dispatch filter: events tagged with a foreign room are not
    // ours; events with no roomId (older/legacy delivery) fall through to be
    // sniffed by content below.
    if (roomId !== undefined && roomId !== this.aiRoomId) return;

    if (eventType === EVENT_PEER_DISCONNECTED) {
      this.handlePeerDisconnected(fromId);
      return;
    }
    if (eventType !== EVENT_RAW) return;

    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
    // collab.ts's Yjs sync/awareness frames are tagged with a leading 0x00/0x01
    // varint and share this same unscoped EVENT_RAW channel — only attempt to
    // decode payloads that look like our JSON protocol (leading '{' = 0x7B).
    if (roomId === undefined && bytes[0] !== 0x7b) return;

    const msg = decode(bytes);
    if (!msg) return;
    this.handleProtocolMessage(fromId, msg);
  };

  private handlePeerDisconnected(peerId: string): void {
    if (this.providerId !== peerId) return;
    this.providerId = null;
    const err = new MistaiError("PROVIDER_DISCONNECTED", "Connection to the AI provider was lost.");
    this.consumer?.rejectAll(err);
    this.voiceConsumer?.rejectAll(err);
    this.emit({ phase: "searching" });
    this.startProviderTimeout(this.connectGeneration);
  }

  private handleProtocolMessage(fromId: string, msg: ProtocolMessage): void {
    if (msg.type === "provider_hello") {
      if (!this.providerId) {
        this.providerId = fromId;
        if (this.providerTimeoutTimer !== null) {
          clearTimeout(this.providerTimeoutTimer);
          this.providerTimeoutTimer = null;
        }
        // Identify ourselves so the provider can label us a consumer.
        this.send(fromId, { v: 1, type: "consumer_hello" });
        const waiters = this.providerWaiters.splice(0);
        waiters.forEach((waiter) => waiter.resolve(fromId));
        this.emit({ phase: "connected", providerId: fromId, ...(msg.models !== undefined ? { models: msg.models } : {}) });
      } else if (fromId === this.providerId) {
        // Same provider re-announcing — refresh its advertised model list.
        this.emit({ phase: "connected", providerId: fromId, ...(msg.models !== undefined ? { models: msg.models } : {}) });
      }
      return;
    }
    if (msg.type === "tts_response" || msg.type === "stt_response" || msg.type === "voice_error") {
      this.voiceConsumer?.handleMessage(msg);
      return;
    }
    this.consumer?.handleMessage(msg);
  }

  private teardown(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.providerTimeoutTimer !== null) {
      clearTimeout(this.providerTimeoutTimer);
      this.providerTimeoutTimer = null;
    }
    // Scoped leave only — never call the shared node's no-arg leaveRoom(),
    // which would decommission the whole node (killing collab's room too).
    if (this.node && this.aiRoomId) this.node.leaveRoom(this.aiRoomId);

    const err = new MistaiError("PROVIDER_DISCONNECTED", "AI companion connection was closed.");
    this.consumer?.rejectAll(err);
    this.voiceConsumer?.rejectAll(err);
    this.rejectProviderWaiters(err);

    this.node = null;
    this.consumer = null;
    this.voiceConsumer = null;
    this.providerId = null;
    this.aiRoomId = null;
  }

  /** Tears down the active/pending connection (if any) and resets status to idle. */
  disconnect(): void {
    this.teardown();
    this.connectGeneration += 1; // invalidate any in-flight doConnect()
    this.emit({ phase: "idle" });
  }

  private waitForProvider(): Promise<string> {
    if (this.providerId) return Promise.resolve(this.providerId);
    if (!this.aiRoomId) return Promise.reject(new MistaiError("NO_ROOM_ID", "AI companion room is not set."));

    return new Promise((resolve, reject) => {
      const waiter: ProviderWaiter = {
        resolve: (providerId) => {
          clearTimeout(timer);
          resolve(providerId);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        const index = this.providerWaiters.indexOf(waiter);
        if (index >= 0) this.providerWaiters.splice(index, 1);
        reject(new MistaiError("PROVIDER_NOT_FOUND", "No provider found on the AI companion network."));
      }, PROVIDER_WAIT_TIMEOUT_MS);
      this.providerWaiters.push(waiter);
    });
  }

  /** Sends a chat request; waits for a connected provider first (with timeout) if needed. */
  async requestChat(
    messages: ChatMessage[],
    options: { model?: string; onDelta?: (delta: string, full: string) => void } = {},
  ): Promise<string> {
    if (!this.consumer) throw new MistaiError("NO_ROOM_ID", "AI companion room is not set.");
    const providerId = await this.waitForProvider();
    return this.consumer.request(providerId, messages, options);
  }

  /** Requests speech synthesis; waits for a connected provider first (with timeout) if needed. */
  async requestTts(params: { text: string; model?: string; voice?: string }): Promise<Blob> {
    if (!this.voiceConsumer) throw new MistaiError("NO_ROOM_ID", "AI companion room is not set.");
    const providerId = await this.waitForProvider();
    return this.voiceConsumer.requestTts(providerId, params);
  }
}

let singleton: CompanionClient | null = null;

export function getCompanionClient(): CompanionClient {
  if (!singleton) singleton = new CompanionClient();
  return singleton;
}

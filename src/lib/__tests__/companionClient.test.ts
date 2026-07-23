import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionClient, type CompanionMistNode, type CompanionNodeAccess, type CompanionStatus } from "../ai/companionClient";
import { decode, encode, type ProtocolMessage } from "../../vendor/mistai";
import { DELIVERY_RELIABLE, EVENT_PEER_DISCONNECTED, EVENT_RAW } from "../../vendor/mistlib/wrappers/web/index.js";
import type { NodeEventHandler } from "../mistNode";

// Fake shared-node harness: records every joinRoom/sendMessage/leaveRoom call
// and lets the test fire node events into whatever handler CompanionClient
// registered via addEventHandler — standing in for mistNode.ts's real fan-out
// dispatcher without spinning up the wasm node.
class FakeNode implements CompanionMistNode {
  joinRoom = vi.fn();
  leaveRoom = vi.fn();
  sendMessage = vi.fn();
}

function createHarness() {
  const node = new FakeNode();
  let handler: NodeEventHandler | null = null;
  const access: CompanionNodeAccess = {
    ensure: vi.fn(async () => node),
    addEventHandler: vi.fn((h: NodeEventHandler) => {
      handler = h;
      return vi.fn(() => {
        handler = null;
      });
    }),
  };
  return {
    node,
    access,
    fire(eventType: number, fromId: string, payload: unknown, roomId?: string): void {
      handler?.(eventType, fromId, payload, roomId);
    },
  };
}

interface SentMessage {
  toId: string | null;
  msg: ProtocolMessage;
  delivery: number;
  roomId: string;
}

function sentMessages(node: FakeNode): SentMessage[] {
  return node.sendMessage.mock.calls.map(([toId, payload, delivery, roomId]) => {
    const msg = decode(payload as Uint8Array);
    if (!msg) throw new Error("test bug: sendMessage payload did not decode");
    return { toId: toId as string | null, msg, delivery: delivery as number, roomId: roomId as string };
  });
}

function findByType(node: FakeNode, type: ProtocolMessage["type"]): SentMessage | undefined {
  return sentMessages(node).find((m) => m.msg.type === type);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CompanionClient discovery", () => {
  it("joins the room, broadcasts consumer_hello, and becomes connected on provider_hello", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    const statuses: CompanionStatus[] = [];
    client.onStatusChange((s) => statuses.push(s));

    client.connect("room-1");
    expect(client.status.phase).toBe("joining");

    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalledWith("room-1"));
    expect(client.status.phase).toBe("searching");

    const broadcastHello = findByType(node, "consumer_hello");
    expect(broadcastHello).toMatchObject({ toId: null, roomId: "room-1", delivery: DELIVERY_RELIABLE });

    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello", models: ["gpt-x"] }), "room-1");

    expect(client.status).toEqual({ phase: "connected", providerId: "provider-1", models: ["gpt-x"] });
    const unicastHello = sentMessages(node).filter((m) => m.msg.type === "consumer_hello" && m.toId === "provider-1");
    expect(unicastHello).toHaveLength(1);
  });

  it("captures provider_hello.voices into status.voices (tts-voice-selection-v1)", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());

    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello", voices: ["alloy", "verse"] }), "room-1");
    expect(client.status).toEqual({ phase: "connected", providerId: "provider-1", voices: ["alloy", "verse"] });

    // Re-announcement from the same provider refreshes the advertised list.
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello", voices: ["alloy"] }), "room-1");
    expect(client.status).toEqual({ phase: "connected", providerId: "provider-1", voices: ["alloy"] });
  });

  it("omits voices from status when the provider doesn't advertise any", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());

    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello" }), "room-1");
    expect(client.status).toEqual({ phase: "connected", providerId: "provider-1" });
    expect((client.status as { voices?: string[] }).voices).toBeUndefined();
  });

  it("is a no-op when connect() is called again for the same room", async () => {
    const { node, access } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());
    expect(node.joinRoom).toHaveBeenCalledTimes(1);
    expect(access.ensure).toHaveBeenCalledTimes(1);
  });

  it("switches rooms when connect() is called with a different roomId", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalledWith("room-1"));
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello" }), "room-1");
    expect(client.status.phase).toBe("connected");

    client.connect("room-2");
    expect(node.leaveRoom).toHaveBeenCalledWith("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalledWith("room-2"));
    expect(client.status.phase).toBe("searching");
  });

  it("ignores events tagged with a foreign room id", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());

    fire(EVENT_RAW, "provider-x", encode({ v: 1, type: "provider_hello" }), "other-room");
    expect(client.status.phase).toBe("searching");
  });

  it("ignores unscoped EVENT_RAW payloads that aren't JSON (e.g. collab's Yjs frames)", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());

    fire(EVENT_RAW, "someone", new Uint8Array([0x00, 0x01, 0x02]), undefined);
    expect(client.status.phase).toBe("searching");
  });

  it("transitions to error/PROVIDER_NOT_FOUND if no provider announces within the wait timeout", async () => {
    vi.useFakeTimers();
    const { node, access } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");

    await vi.advanceTimersByTimeAsync(0);
    expect(node.joinRoom).toHaveBeenCalledWith("room-1");
    expect(client.status.phase).toBe("searching");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.status).toEqual({
      phase: "error",
      message: expect.any(String),
      code: "PROVIDER_NOT_FOUND",
    });
  });
});

describe("CompanionClient provider disconnect", () => {
  it("resets to searching and rejects in-flight requests", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello" }), "room-1");
    expect(client.status.phase).toBe("connected");

    const chatPromise = client.requestChat([{ role: "user", content: "hi" }]);
    await vi.waitFor(() => expect(findByType(node, "llm_request")).toBeTruthy());

    fire(EVENT_PEER_DISCONNECTED, "provider-1", undefined, "room-1");
    expect(client.status.phase).toBe("searching");
    await expect(chatPromise).rejects.toThrow();
  });

  it("does not react to a disconnect from a peer that isn't the current provider", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello" }), "room-1");

    fire(EVENT_PEER_DISCONNECTED, "someone-else", undefined, "room-1");
    expect(client.status).toEqual({ phase: "connected", providerId: "provider-1" });
  });
});

describe("CompanionClient chat/tts roundtrip", () => {
  async function connectAndAnnounce(): Promise<ReturnType<typeof createHarness> & { client: CompanionClient }> {
    const harness = createHarness();
    const client = new CompanionClient(harness.access);
    client.connect("room-1");
    await vi.waitFor(() => expect(harness.node.joinRoom).toHaveBeenCalled());
    harness.fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello" }), "room-1");
    return { ...harness, client };
  }

  it("completes a chat request via injected llm_response_chunk/llm_response_done", async () => {
    const { node, fire, client } = await connectAndAnnounce();

    const deltas: string[] = [];
    const chatPromise = client.requestChat([{ role: "user", content: "hi" }], {
      onDelta: (delta) => deltas.push(delta),
    });

    const request = await vi.waitFor(() => {
      const found = findByType(node, "llm_request");
      if (!found) throw new Error("llm_request not sent yet");
      return found;
    });
    const requestId = (request.msg as Extract<ProtocolMessage, { type: "llm_request" }>).id;

    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "llm_response_chunk", id: requestId, delta: "Hel" }), "room-1");
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "llm_response_chunk", id: requestId, delta: "lo" }), "room-1");
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "llm_response_done", id: requestId }), "room-1");

    await expect(chatPromise).resolves.toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("completes a tts request via injected tts_response chunks", async () => {
    const { node, fire, client } = await connectAndAnnounce();

    const ttsPromise = client.requestTts({ text: "hello" });

    const request = await vi.waitFor(() => {
      const found = findByType(node, "tts_request");
      if (!found) throw new Error("tts_request not sent yet");
      return found;
    });
    const requestId = (request.msg as Extract<ProtocolMessage, { type: "tts_request" }>).id;

    fire(
      EVENT_RAW,
      "provider-1",
      encode({ v: 1, type: "tts_response", id: requestId, seq: 0, data: "AAAA", last: false, mime: "audio/mpeg" }),
      "room-1",
    );
    fire(
      EVENT_RAW,
      "provider-1",
      encode({ v: 1, type: "tts_response", id: requestId, seq: 1, data: "BBBB", last: true, mime: "audio/mpeg" }),
      "room-1",
    );

    const blob = await ttsPromise;
    expect(blob).toBeInstanceOf(Blob);
  });

  it("requestChat rejects immediately with NO_ROOM_ID if never connected", async () => {
    const { access } = createHarness();
    const client = new CompanionClient(access);
    await expect(client.requestChat([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "NO_ROOM_ID" });
  });

  it("requestTts rejects immediately with NO_ROOM_ID if never connected", async () => {
    const { access } = createHarness();
    const client = new CompanionClient(access);
    await expect(client.requestTts({ text: "hi" })).rejects.toMatchObject({ code: "NO_ROOM_ID" });
  });
});

describe("CompanionClient disconnect", () => {
  it("leaves the scoped room, rejects pending work, and resets to idle", async () => {
    const { node, access, fire } = createHarness();
    const client = new CompanionClient(access);
    client.connect("room-1");
    await vi.waitFor(() => expect(node.joinRoom).toHaveBeenCalled());
    fire(EVENT_RAW, "provider-1", encode({ v: 1, type: "provider_hello" }), "room-1");

    const chatPromise = client.requestChat([{ role: "user", content: "hi" }]);
    await vi.waitFor(() => expect(findByType(node, "llm_request")).toBeTruthy());

    client.disconnect();

    expect(node.leaveRoom).toHaveBeenCalledWith("room-1");
    expect(node.leaveRoom).toHaveBeenCalledTimes(1);
    expect(client.status).toEqual({ phase: "idle" });
    await expect(chatPromise).rejects.toThrow();
  });
});

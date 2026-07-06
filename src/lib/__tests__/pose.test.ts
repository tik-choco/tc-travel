import { afterEach, describe, expect, it } from "vitest";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { dispatchNodeEvent } from "../mistNode";
import { CollabSession, MSG_POSE, type CollabUser, type CompanionPose, type MistNodeAccess } from "../collab";
import { MistNode, EVENT_RAW, DELIVERY_UNRELIABLE } from "../../vendor/mistlib/wrappers/web/index.js";

// Same fake-node pattern as mistDispatch.test.ts: CollabSession's MistNodeAccess
// test seam lets these tests exercise the real handleRawMessage/sendPose code
// paths via the real addNodeEventHandler/dispatchNodeEvent fan-out, without
// spinning up a real (wasm) MistNode.
interface FakeNodeCall {
  toId: string | null | undefined;
  payload: Uint8Array;
  delivery: number | undefined;
  roomId: string | undefined;
}

function createFakeNode(): { node: InstanceType<typeof MistNode>; sendMessageCalls: FakeNodeCall[] } {
  const sendMessageCalls: FakeNodeCall[] = [];
  const fake = {
    joinRoom: () => {},
    sendMessage: (toId: string | null | undefined, payload: Uint8Array, delivery?: number, roomId?: string) => {
      sendMessageCalls.push({ toId, payload, delivery, roomId });
    },
    leaveRoom: () => {},
  };
  return { node: fake as unknown as InstanceType<typeof MistNode>, sendMessageCalls };
}

function createNodeAccess(node: InstanceType<typeof MistNode>, id: string): MistNodeAccess {
  return { ensure: async () => node, currentId: () => id };
}

/** Encodes a raw MSG_POSE frame the way sendPose does, from an arbitrary (possibly malformed) payload. */
function encodePoseFrame(body: unknown): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_POSE);
  const json = typeof body === "string" ? body : JSON.stringify(body);
  encoding.writeUint8Array(encoder, new TextEncoder().encode(json));
  return encoding.toUint8Array(encoder);
}

const userA: CollabUser = { memberId: "member-a", name: "Alice", color: "#123456", avatarEmoji: "\u{1F642}" };

describe("MSG_POSE channel", () => {
  let session: CollabSession | undefined;

  afterEach(() => {
    session?.leave();
    session = undefined;
  });

  it("round-trips a pose from raw bytes through handleRawMessage to a listener", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    const pose: CompanionPose = { memberId: "member-b", x: 1, y: 2, z: 3, ry: 0.5, s: 1, t: 1000 };
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame(pose), "room-a");

    expect(received).toEqual([pose]);
  });

  it("does not deliver a pose carrying our own memberId (echo suppression)", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    const pose: CompanionPose = { memberId: userA.memberId, x: 1, y: 2, z: 3, ry: 0, s: 1, t: 1000 };
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame(pose), "room-a");

    expect(received).toEqual([]);
  });

  it("silently drops malformed JSON", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame("{not valid json"), "room-a");

    expect(received).toEqual([]);
  });

  it("silently drops payloads with non-finite, missing, or wrong-typed fields", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: NaN, y: 0, z: 0, ry: 0, s: 1, t: 1 }), "room-a");
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: 0, y: 0, z: 0, ry: 0, s: 1 }), "room-a"); // missing t
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: 42, x: 0, y: 0, z: 0, ry: 0, s: 1, t: 1 }), "room-a"); // wrong-typed memberId
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "", x: 0, y: 0, z: 0, ry: 0, s: 1, t: 1 }), "room-a"); // empty memberId

    expect(received).toEqual([]);
  });

  it("clamps out-of-range position and scale values", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    dispatchNodeEvent(
      EVENT_RAW,
      "peer-2",
      encodePoseFrame({ memberId: "member-b", x: 9999, y: -9999, z: 0, ry: 0, s: 999, t: 1 }),
      "room-a",
    );

    expect(received).toEqual([{ memberId: "member-b", x: 100, y: -100, z: 0, ry: 0, s: 10, t: 1 }]);
  });

  it("discards a packet whose t is at or before the last accepted t for that member", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: 1, y: 0, z: 0, ry: 0, s: 1, t: 100 }), "room-a");
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: 2, y: 0, z: 0, ry: 0, s: 1, t: 50 }), "room-a"); // stale/reordered
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: 3, y: 0, z: 0, ry: 0, s: 1, t: 100 }), "room-a"); // duplicate t
    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: 4, y: 0, z: 0, ry: 0, s: 1, t: 101 }), "room-a"); // fresh

    expect(received.map((p) => p.x)).toEqual([1, 4]);
  });

  it("sendPose sends an MSG_POSE-prefixed, DELIVERY_UNRELIABLE, room-scoped broadcast with our memberId and a fresh t", async () => {
    const { node, sendMessageCalls } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");
    sendMessageCalls.length = 0;

    const before = Date.now();
    session.sendPose({ x: 1, y: 2, z: 3, ry: 0.1, s: 1 });
    const after = Date.now();

    expect(sendMessageCalls.length).toBe(1);
    const call = sendMessageCalls[0];
    expect(call.toId).toBeNull(); // broadcast
    expect(call.delivery).toBe(DELIVERY_UNRELIABLE);
    expect(call.roomId).toBe("room-a");

    const decoder = decoding.createDecoder(call.payload);
    expect(decoding.readVarUint(decoder)).toBe(MSG_POSE);
    const body = JSON.parse(new TextDecoder().decode(decoding.readTailAsUint8Array(decoder))) as CompanionPose;
    expect(body).toMatchObject({ memberId: userA.memberId, x: 1, y: 2, z: 3, ry: 0.1, s: 1 });
    expect(body.t).toBeGreaterThanOrEqual(before);
    expect(body.t).toBeLessThanOrEqual(after);
  });

  it("sendPose is a no-op when the session isn't joined", () => {
    session = new CollabSession(userA);
    expect(() => session!.sendPose({ x: 0, y: 0, z: 0, ry: 0, s: 1 })).not.toThrow();
  });

  it("stops delivering to a listener once the session has left", async () => {
    const { node } = createFakeNode();
    session = new CollabSession(userA, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    const received: CompanionPose[] = [];
    session.onPose((p) => received.push(p));

    session.leave();
    const left = session;
    session = undefined; // already left; afterEach shouldn't call leave() again

    dispatchNodeEvent(EVENT_RAW, "peer-2", encodePoseFrame({ memberId: "member-b", x: 1, y: 0, z: 0, ry: 0, s: 1, t: 1 }), "room-a");

    expect(received).toEqual([]);
    void left;
  });
});

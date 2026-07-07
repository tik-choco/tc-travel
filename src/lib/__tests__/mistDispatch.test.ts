import { afterEach, describe, expect, it, vi } from "vitest";
import { addNodeEventHandler, dispatchNodeEvent } from "../mistNode";
import { CollabSession, type CollabUser, type MistNodeAccess } from "../collab";
import { MistNode, EVENT_PEER_CONNECTED } from "../../vendor/mistlib/wrappers/web/index.js";

// dispatchNodeEvent is mistNode.ts's fan-out core (see its @internal comment):
// exercising it directly lets these tests cover the dispatcher without
// spinning up a real (wasm) MistNode via ensureMistNode.
describe("node event dispatcher", () => {
  it("delivers an event to every registered handler", () => {
    const calls1: unknown[][] = [];
    const calls2: unknown[][] = [];
    const unsub1 = addNodeEventHandler((...args) => calls1.push(args));
    const unsub2 = addNodeEventHandler((...args) => calls2.push(args));
    try {
      dispatchNodeEvent(EVENT_PEER_CONNECTED, "peerA", { hello: true }, "room-x");
      expect(calls1).toEqual([[EVENT_PEER_CONNECTED, "peerA", { hello: true }, "room-x"]]);
      expect(calls2).toEqual([[EVENT_PEER_CONNECTED, "peerA", { hello: true }, "room-x"]]);
    } finally {
      unsub1();
      unsub2();
    }
  });

  it("stops delivering to a handler once unsubscribed", () => {
    const calls: unknown[][] = [];
    const unsub = addNodeEventHandler((...args) => calls.push(args));
    unsub();
    dispatchNodeEvent(EVENT_PEER_CONNECTED, "peerA", null, undefined);
    expect(calls).toEqual([]);
  });

  it("isolates a throwing handler so it doesn't block the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[][] = [];
    const unsub1 = addNodeEventHandler(() => {
      throw new Error("boom");
    });
    const unsub2 = addNodeEventHandler((...args) => calls.push(args));
    try {
      expect(() => dispatchNodeEvent(EVENT_PEER_CONNECTED, "peerA", null, undefined)).not.toThrow();
      expect(calls.length).toBe(1);
      expect(warn).toHaveBeenCalledWith("tc-travel: node event handler failed", expect.any(Error));
    } finally {
      unsub1();
      unsub2();
      warn.mockRestore();
    }
  });
});

// CollabSession no longer registers node.onEvent directly — it goes through
// the same shared addNodeEventHandler/dispatchNodeEvent pair above, exactly
// like production code would with the real page node. These tests inject a
// fake node via CollabSession's MistNodeAccess test seam so no real (wasm)
// node is ever created.
interface FakeNodeCall {
  toId: string | null | undefined;
  roomId: string | undefined;
}

function createFakeNode(): { node: InstanceType<typeof MistNode>; sendMessageCalls: FakeNodeCall[]; leaveRoomCalls: (string | undefined)[] } {
  const sendMessageCalls: FakeNodeCall[] = [];
  const leaveRoomCalls: (string | undefined)[] = [];
  const fake = {
    joinRoom: () => {},
    sendMessage: (toId: string | null | undefined, _payload: unknown, _delivery?: number, roomId?: string) => {
      sendMessageCalls.push({ toId, roomId });
    },
    leaveRoom: (roomId?: string) => {
      leaveRoomCalls.push(roomId);
    },
  };
  return { node: fake as unknown as InstanceType<typeof MistNode>, sendMessageCalls, leaveRoomCalls };
}

function createNodeAccess(node: InstanceType<typeof MistNode>, id: string): MistNodeAccess {
  return { ensure: async () => node, currentId: () => id };
}

const testUser: CollabUser = { memberId: "member-1", name: "Alice", color: "#123456", avatarEmoji: "\u{1F642}" };

describe("CollabSession room scoping", () => {
  let session: CollabSession | undefined;

  afterEach(() => {
    session?.leave();
    session = undefined;
  });

  it("ignores dispatched events tagged with a different room", async () => {
    const { node, sendMessageCalls } = createFakeNode();
    session = new CollabSession(testUser, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");
    const before = sendMessageCalls.length;

    dispatchNodeEvent(EVENT_PEER_CONNECTED, "peerB", undefined, "room-b");

    expect(sendMessageCalls.length).toBe(before);
  });

  it("processes dispatched events tagged with the matching room", async () => {
    const { node, sendMessageCalls } = createFakeNode();
    session = new CollabSession(testUser, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");
    const before = sendMessageCalls.length;

    dispatchNodeEvent(EVENT_PEER_CONNECTED, "peerB", undefined, "room-a");

    const newCalls = sendMessageCalls.slice(before);
    expect(newCalls.length).toBeGreaterThan(0);
    expect(newCalls.every((c) => c.toId === "peerB" && c.roomId === "room-a")).toBe(true);
  });

  it("processes dispatched events with no room attached, for backward compatibility", async () => {
    const { node, sendMessageCalls } = createFakeNode();
    session = new CollabSession(testUser, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");
    const before = sendMessageCalls.length;

    dispatchNodeEvent(EVENT_PEER_CONNECTED, "peerB", undefined, undefined);

    expect(sendMessageCalls.slice(before).length).toBeGreaterThan(0);
  });

  it("tags outgoing sends with this session's room id", async () => {
    const { node, sendMessageCalls } = createFakeNode();
    session = new CollabSession(testUser, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");
    sendMessageCalls.length = 0;

    session.transact(() => {
      session!.doc.getArray("test").push([1]);
    });

    expect(sendMessageCalls.length).toBeGreaterThan(0);
    expect(sendMessageCalls.every((c) => c.roomId === "room-a")).toBe(true);
  });

  it("leaves scoped to this session's room id, not the whole node", async () => {
    const { node, leaveRoomCalls } = createFakeNode();
    session = new CollabSession(testUser, {}, createNodeAccess(node, "peer-1"));
    await session.join("room-a");

    session.leave();
    session = undefined; // already left; afterEach shouldn't call leave() again

    expect(leaveRoomCalls).toEqual(["room-a"]);
  });

  it("survives a room-scoped send racing mistlib's async room build", async () => {
    // mistlib builds a room's session asynchronously after joinRoom(); until it
    // settles, send_message_in_room throws a raw string "Room not joined: <id>"
    // (see collab.ts isRoomNotJoinedError). The first awareness/sync sends fire
    // right after join, inside that window — they must be dropped, never thrown,
    // or an invite-link join rejects with an uncaught "Room not joined".
    let built = false;
    const sends: FakeNodeCall[] = [];
    const fake = {
      joinRoom: () => {},
      sendMessage: (toId: string | null | undefined, _payload: unknown, _delivery?: number, roomId?: string) => {
        if (roomId && !built) throw `Room not joined: ${roomId}`; // mirrors the wasm's JsValue string
        sends.push({ toId, roomId });
      },
      leaveRoom: () => {},
    } as unknown as InstanceType<typeof MistNode>;
    session = new CollabSession(testUser, {}, createNodeAccess(fake, "peer-1"));

    // join() broadcasts awareness before the build settles — must not reject.
    await expect(session.join("room-a")).resolves.toBeUndefined();
    // A local edit during the build window must not throw out of transact() either.
    expect(() =>
      session!.transact(() => {
        session!.doc.getArray("t").push([1]);
      }),
    ).not.toThrow();

    // Once the room is built, sends flow again as normal, room-scoped.
    built = true;
    session.transact(() => {
      session!.doc.getArray("t").push([2]);
    });
    expect(sends.some((c) => c.roomId === "room-a")).toBe(true);
  });
});

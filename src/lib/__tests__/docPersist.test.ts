import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { __setDocPersistWriterForTest, attachDocPersistence, loadDocState } from "../docPersist";

// The node test runner has no IndexedDB, so (matching the repo's convention of
// testing at an injectable seam — see admin1Resolver's __set...ForTest) the
// debounce/flush/detach behavior is exercised against an injected writer. The
// real IndexedDB read/write path needs the manual two-client browser smoke test.

interface WriteCall {
  roomId: string;
  bytes: Uint8Array;
}

let writes: WriteCall[];

beforeEach(() => {
  vi.useFakeTimers();
  writes = [];
  __setDocPersistWriterForTest((roomId, bytes) => {
    writes.push({ roomId, bytes });
  });
});

afterEach(() => {
  __setDocPersistWriterForTest(null);
  vi.useRealTimers();
});

const makeDoc = (): Y.Doc => new Y.Doc();
const edit = (doc: Y.Doc, value: string): void => {
  doc.getArray<string>("photos").push([value]);
};

describe("loadDocState", () => {
  it("returns null (not a rejection) when IndexedDB is unavailable", async () => {
    // vitest's node environment has no `indexedDB` global — the private-mode /
    // storage-broken tolerance path.
    await expect(loadDocState("room-a")).resolves.toBeNull();
  });
});

describe("attachDocPersistence — debounce", () => {
  it("coalesces a burst of edits into one trailing write with the full doc state", () => {
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    edit(doc, "one");
    edit(doc, "two");
    edit(doc, "three");
    expect(writes).toHaveLength(0); // nothing until the trailing window elapses

    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
    expect(writes[0].roomId).toBe("room-a");
    // The written blob is the FULL state: applying it to a fresh doc restores everything.
    const restored = new Y.Doc();
    Y.applyUpdate(restored, writes[0].bytes);
    expect(restored.getArray<string>("photos").toArray()).toEqual(["one", "two", "three"]);
    detach();
  });

  it("is trailing: each new edit pushes the flush out", () => {
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    edit(doc, "one");
    vi.advanceTimersByTime(600);
    edit(doc, "two"); // resets the window
    vi.advanceTimersByTime(600); // 1200ms after the first edit, 600 after the last
    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(400); // 1000ms after the last edit
    expect(writes).toHaveLength(1);
    detach();
  });

  it("writes again for edits after a flush", () => {
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    edit(doc, "one");
    vi.advanceTimersByTime(1000);
    edit(doc, "two");
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(2);
    detach();
  });
});

describe("attachDocPersistence — detach", () => {
  it("flushes pending edits immediately on detach and cancels the timer", () => {
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    edit(doc, "one");
    expect(writes).toHaveLength(0);
    detach();
    expect(writes).toHaveLength(1); // final flush, no waiting for the window
    vi.advanceTimersByTime(5000);
    expect(writes).toHaveLength(1); // the pending timer was cleared, no double write
  });

  it("does not flush on detach when nothing is pending", () => {
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    edit(doc, "one");
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
    detach(); // already flushed — nothing dirty
    expect(writes).toHaveLength(1);
  });

  it("unsubscribes: edits after detach never write, and detach is idempotent", () => {
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    detach();
    detach(); // second call is a no-op
    edit(doc, "late");
    vi.advanceTimersByTime(5000);
    expect(writes).toHaveLength(0);
  });
});

describe("attachDocPersistence — storage-error tolerance", () => {
  it("swallows a throwing writer on both timer flush and detach flush", () => {
    __setDocPersistWriterForTest(() => {
      throw new Error("QuotaExceededError");
    });
    const doc = makeDoc();
    const detach = attachDocPersistence("room-a", doc);
    edit(doc, "one");
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    edit(doc, "two");
    expect(() => detach()).not.toThrow();
  });
});

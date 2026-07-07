import { describe, expect, it, vi } from "vitest";
import { derivePresence, onTogether, shouldCelebrateTogether } from "../store";

// The pure seams of WP-Party's presence work (store.ts exports them exactly so
// they can be tested without a live CollabSession / mist node): the three-state
// presence derivation and the once-per-room 0→>0 together transition.

describe("derivePresence", () => {
  it("is 'connecting' whenever the transport isn't connected", () => {
    expect(derivePresence(false, 0)).toBe("connecting");
    // peers without a connected transport shouldn't happen, but never claim
    // togetherness off a stale roster
    expect(derivePresence(false, 2)).toBe("connecting");
  });

  it("is 'waiting' when connected but alone — the optimistic flag alone is not 'together'", () => {
    expect(derivePresence(true, 0)).toBe("waiting");
  });

  it("is 'together' only when connected AND a peer is actually present", () => {
    expect(derivePresence(true, 1)).toBe("together");
    expect(derivePresence(true, 3)).toBe("together");
  });
});

describe("shouldCelebrateTogether", () => {
  it("fires on the 0→>0 crossing and records the room as seen", () => {
    const seen = new Set<string>();
    expect(shouldCelebrateTogether(0, 1, "room-a", seen)).toBe(true);
    expect(seen.has("room-a")).toBe(true);
  });

  it("does not fire when peers were already present or none arrived", () => {
    const seen = new Set<string>();
    expect(shouldCelebrateTogether(1, 2, "room-a", seen)).toBe(false); // growth, not arrival
    expect(shouldCelebrateTogether(0, 0, "room-a", seen)).toBe(false); // still alone
    expect(shouldCelebrateTogether(2, 0, "room-a", seen)).toBe(false); // everyone left
    expect(seen.size).toBe(0);
  });

  it("dedupes per room per launch: a partner dropping and rejoining doesn't re-greet", () => {
    const seen = new Set<string>();
    expect(shouldCelebrateTogether(0, 1, "room-a", seen)).toBe(true);
    // peer disconnects (1→0), then reconnects (0→1) — same launch, same room
    expect(shouldCelebrateTogether(0, 1, "room-a", seen)).toBe(false);
  });

  it("greets each distinct room once", () => {
    const seen = new Set<string>();
    expect(shouldCelebrateTogether(0, 1, "room-a", seen)).toBe(true);
    expect(shouldCelebrateTogether(0, 2, "room-b", seen)).toBe(true);
    expect(shouldCelebrateTogether(0, 1, "room-b", seen)).toBe(false);
  });
});

describe("onTogether", () => {
  it("subscribes without firing and unsubscribes cleanly (idempotent)", () => {
    const cb = vi.fn();
    const off = onTogether(cb);
    expect(cb).not.toHaveBeenCalled(); // no synchronous replay on subscribe
    off();
    expect(() => off()).not.toThrow(); // double-unsubscribe is a no-op
  });
});

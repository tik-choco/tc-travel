import { describe, expect, it } from "vitest";
import { partitionLetters } from "../letters";
import type { Letter } from "../types";

let seq = 0;
function letter(overrides: Partial<Letter> = {}): Letter {
  seq += 1;
  return {
    id: `letter-${seq}`,
    from: "alice",
    to: "bob",
    at: seq,
    subject: "Greetings",
    body: "Safe travels!",
    seal: "\u{1F48C}",
    read: false,
    ...overrides,
  };
}

describe("partitionLetters", () => {
  it("splits letters into inbox (to me) and sent (from me)", () => {
    const toMe = letter({ from: "alice", to: "me" });
    const fromMe = letter({ from: "me", to: "alice" });
    const { inbox, sent } = partitionLetters([toMe, fromMe], "me");
    expect(inbox).toEqual([toMe]);
    expect(sent).toEqual([fromMe]);
  });

  it("counts only unread inbox letters", () => {
    const result = partitionLetters(
      [
        letter({ to: "me", read: false }),
        letter({ to: "me", read: true }),
        letter({ to: "me", read: false }),
        // unread but sent BY me — must not count toward my inbox badge
        letter({ from: "me", to: "alice", read: false }),
      ],
      "me",
    );
    expect(result.inbox).toHaveLength(3);
    expect(result.unreadCount).toBe(2);
  });

  it("excludes letters between other members entirely", () => {
    const result = partitionLetters(
      [letter({ from: "alice", to: "bob" }), letter({ from: "bob", to: "alice", read: false })],
      "me",
    );
    expect(result.inbox).toEqual([]);
    expect(result.sent).toEqual([]);
    expect(result.unreadCount).toBe(0);
  });

  it("returns empty piles for no letters", () => {
    expect(partitionLetters([], "me")).toEqual({ inbox: [], sent: [], unreadCount: 0 });
  });

  it("preserves input order within each pile", () => {
    const first = letter({ from: "me", to: "me", subject: "first" });
    const second = letter({ to: "me", subject: "second" });
    const third = letter({ from: "me", to: "alice", subject: "third" });
    const { inbox, sent } = partitionLetters([first, second, third], "me");
    expect(inbox.map((l) => l.subject)).toEqual(["first", "second"]);
    expect(sent.map((l) => l.subject)).toEqual(["first", "third"]);
  });
});

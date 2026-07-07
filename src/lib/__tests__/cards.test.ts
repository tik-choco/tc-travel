import { describe, expect, it } from "vitest";
import { upsertCard } from "../cards";
import { encodeCard, parseCard } from "../cardQr";
import { translate } from "../i18n";
import type { Card } from "../types";

let seq = 0;
function card(overrides: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `traveler-${seq}`,
    name: "Aria",
    avatarEmoji: "\u{1F9ED}",
    color: "#c9a227",
    message: "Safe travels!",
    at: seq,
    ...overrides,
  };
}

describe("upsertCard", () => {
  it("adds a new card to an empty collection", () => {
    const incoming = card({ receivedAt: 100 });
    expect(upsertCard([], incoming)).toEqual([incoming]);
  });

  it("dedupes by id, replacing the card's content", () => {
    const old = card({ id: "aria", message: "old words", receivedAt: 100 });
    const fresh = card({ id: "aria", message: "new words", receivedAt: 100 });
    const result = upsertCard([old], fresh);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("new words");
  });

  it("keeps the earliest receivedAt when rescanning the same person", () => {
    const firstMeeting = card({ id: "aria", receivedAt: 100 });
    const rescan = card({ id: "aria", message: "updated", receivedAt: 900 });
    const result = upsertCard([firstMeeting], rescan);
    expect(result).toHaveLength(1);
    expect(result[0].receivedAt).toBe(100);
    expect(result[0].message).toBe("updated");
  });

  it("orders the collection newest-first by receivedAt", () => {
    const oldest = card({ id: "a", receivedAt: 10 });
    const newest = card({ id: "b", receivedAt: 30 });
    const middle = card({ id: "c", receivedAt: 20 });
    const result = upsertCard(upsertCard([oldest], newest), middle);
    expect(result.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input list", () => {
    const original = [card({ id: "a", receivedAt: 10 })];
    const snapshot = [...original];
    upsertCard(original, card({ id: "a", message: "changed", receivedAt: 5 }));
    expect(original).toEqual(snapshot);
  });
});

/** UTF-8-safe base64 for hand-built payloads (bare btoa throws on non-latin-1). */
function encodePayload(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `tctravel-card:1:${btoa(binary)}`;
}

describe("encodeCard / parseCard", () => {
  it("roundtrips a card, excluding receivedAt", () => {
    const mine = card({ name: "旅人ミナ", message: "また会おうね！\u{1F338}", receivedAt: 12345 });
    const text = encodeCard(mine);
    expect(text.startsWith("tctravel-card:1:")).toBe(true);
    const { receivedAt: _local, ...expected } = mine;
    expect(parseCard(text)).toEqual(expected);
  });

  it("rejects a room-join URL", () => {
    expect(parseCard("https://example.com/tc-travel/#/join/abc123")).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(parseCard("")).toBeNull();
    expect(parseCard("hello world")).toBeNull();
    expect(parseCard("tctravel-card:1:!!!not-base64!!!")).toBeNull();
    // valid base64url, but not a JSON object
    expect(parseCard(encodePayload([1, 2]))).toBeNull();
    expect(parseCard(encodePayload("just a string"))).toBeNull();
  });

  it("rejects a card whose id is missing or out of bounds", () => {
    expect(parseCard(encodePayload({ name: "no id" }))).toBeNull();
    expect(parseCard(encodePayload({ id: "" }))).toBeNull();
    expect(parseCard(encodePayload({ id: 42 }))).toBeNull();
    expect(parseCard(encodePayload({ id: "x".repeat(65) }))).toBeNull();
  });

  it("clamps oversized fields and falls back on invalid ones", () => {
    const payload = {
      id: "aria",
      name: `  ${"n".repeat(200)}  `,
      avatarEmoji: "\u{1F9ED}".repeat(20), // > 16 code units → fallback, not slice
      color: "javascript:alert(1)",
      message: "m".repeat(500),
      at: Number.POSITIVE_INFINITY,
    };
    const before = Date.now();
    const parsed = parseCard(encodePayload(payload));
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("aria");
    expect(parsed!.name).toBe("n".repeat(80));
    expect(parsed!.avatarEmoji).toBe("\u{1F9ED}");
    expect(parsed!.color).toBe("#888888");
    expect(parsed!.message).toBe("m".repeat(300));
    expect(parsed!.at).toBeGreaterThanOrEqual(before);
  });

  it("defaults an empty name and non-string message", () => {
    const parsed = parseCard(encodePayload({ id: "aria", name: "   ", message: 7 }));
    // The fallback name is localized (common.anonymous), so the expectation
    // resolves through the same dictionary rather than pinning one locale.
    expect(parsed!.name).toBe(translate("common.anonymous"));
    expect(parsed!.message).toBe("");
  });
});

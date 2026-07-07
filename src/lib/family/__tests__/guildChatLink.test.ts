import { afterEach, describe, expect, it, vi } from "vitest";
import { guildChatUrl } from "../guildChatLink";

describe("guildChatUrl", () => {
  afterEach(() => {
    delete (globalThis as { location?: unknown }).location;
    vi.unstubAllEnvs();
  });

  it("builds a same-origin subpath link with the room id in the hash", () => {
    (globalThis as { location?: { origin: string } }).location = { origin: "https://example.com" };
    const url = guildChatUrl("room-42", "");
    expect(url).toBe("https://example.com/tc-chat/#/room-42");
  });

  it("carries the room name as a query param for first-visit seeding", () => {
    (globalThis as { location?: { origin: string } }).location = { origin: "https://example.com" };
    const url = guildChatUrl("room-42", "Kyoto Crew");
    expect(url).toBe("https://example.com/tc-chat/?name=Kyoto%20Crew#/room-42");
  });

  it("omits the name param when the room has no name yet", () => {
    (globalThis as { location?: { origin: string } }).location = { origin: "https://example.com" };
    expect(guildChatUrl("room-42", "   ")).toBe("https://example.com/tc-chat/#/room-42");
  });

  it("clamps an oversized room id to the chat app's own 64-char limit", () => {
    (globalThis as { location?: { origin: string } }).location = { origin: "https://example.com" };
    const longId = "a".repeat(128);
    const url = guildChatUrl(longId, "");
    expect(url).toBe(`https://example.com/tc-chat/#/${"a".repeat(64)}`);
  });

  it("honors a VITE_TC_CHAT_URL override (e.g. a separate dev port or domain)", () => {
    (globalThis as { location?: { origin: string } }).location = { origin: "https://example.com" };
    vi.stubEnv("VITE_TC_CHAT_URL", "http://localhost:5174");
    const url = guildChatUrl("room-42", "");
    expect(url).toBe("http://localhost:5174/#/room-42");
  });
});

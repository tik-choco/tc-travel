import { afterEach, describe, expect, it } from "vitest";
import { buildJoinUrl, parseJoinInput } from "../qr";

describe("buildJoinUrl", () => {
  afterEach(() => {
    delete (globalThis as { location?: unknown }).location;
  });

  it("emits a hash route parseJoinInput round-trips (regression: a hashless /join/ path 404s on static hosting)", () => {
    (globalThis as { location?: { origin: string } }).location = { origin: "https://example.com" };
    const url = buildJoinUrl("room-42");
    expect(url).toContain("#/join/room-42");
    expect(parseJoinInput(url)).toBe("room-42");
  });
});

describe("parseJoinInput", () => {
  it("extracts the roomId from a full join URL", () => {
    expect(parseJoinInput("https://example.com/tc-travel/#/join/abc-123")).toBe("abc-123");
  });

  it("extracts the roomId from a join URL with a base path", () => {
    expect(parseJoinInput("https://example.com/some/base/#/join/room_ABC")).toBe("room_ABC");
  });

  it("accepts a bare valid roomId", () => {
    expect(parseJoinInput("abc-123")).toBe("abc-123");
    expect(parseJoinInput(crypto.randomUUID())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("trims surrounding whitespace", () => {
    expect(parseJoinInput("  room-42  \n")).toBe("room-42");
  });

  it("rejects invalid input", () => {
    expect(parseJoinInput("")).toBeNull();
    expect(parseJoinInput("   ")).toBeNull();
    expect(parseJoinInput("not a room id!")).toBeNull();
    expect(parseJoinInput("https://example.com/#/join/has spaces")).toBeNull();
    expect(parseJoinInput("https://example.com/no-hash-route")).toBeNull();
    expect(parseJoinInput("a".repeat(129))).toBeNull(); // exceeds the 128-char cap
  });

  it("accepts the 128-char boundary", () => {
    const maxId = "a".repeat(128);
    expect(parseJoinInput(maxId)).toBe(maxId);
  });
});

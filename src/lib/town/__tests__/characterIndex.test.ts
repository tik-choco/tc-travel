import { describe, expect, it } from "vitest";
import { extractCharacterIndexList } from "../characterIndex";

describe("extractCharacterIndexList", () => {
  it("returns the array as-is for a bare CharacterIndexEntry[] payload", () => {
    const parsed = [{ id: "1" }, { id: "2" }];
    expect(extractCharacterIndexList(parsed)).toBe(parsed);
  });

  it("unwraps `.entries` for a {v, updatedAt, entries} payload (current tc-town writer)", () => {
    const entries = [{ id: "1" }, { id: "2" }];
    const parsed = { v: 1, updatedAt: "2026-07-13T00:00:00.000Z", entries };
    expect(extractCharacterIndexList(parsed)).toBe(entries);
  });

  it("returns null when `.entries` is missing or not an array", () => {
    expect(extractCharacterIndexList({ v: 1, updatedAt: "x" })).toBeNull();
    expect(extractCharacterIndexList({ v: 1, entries: "not-an-array" })).toBeNull();
  });

  it("returns null for primitives and null input", () => {
    expect(extractCharacterIndexList(null)).toBeNull();
    expect(extractCharacterIndexList(undefined)).toBeNull();
    expect(extractCharacterIndexList("oops")).toBeNull();
    expect(extractCharacterIndexList(42)).toBeNull();
  });
});

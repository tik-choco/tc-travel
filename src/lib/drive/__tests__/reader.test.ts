import { describe, expect, it } from "vitest";
import { extractDriveIndexList } from "../reader";

describe("extractDriveIndexList", () => {
  it("returns the array as-is for a bare DriveIndexEntry[] payload", () => {
    const parsed = [{ id: "1" }, { id: "2" }];
    expect(extractDriveIndexList(parsed)).toBe(parsed);
  });

  it("unwraps `.files` for a {version, updatedAt, files} payload (current tc-storage writer)", () => {
    const files = [{ id: "1" }, { id: "2" }];
    const parsed = { version: 1, updatedAt: "2026-07-13T00:00:00.000Z", files };
    expect(extractDriveIndexList(parsed)).toBe(files);
  });

  it("returns null when `.files` is missing or not an array", () => {
    expect(extractDriveIndexList({ version: 1, updatedAt: "x" })).toBeNull();
    expect(extractDriveIndexList({ version: 1, files: "not-an-array" })).toBeNull();
  });

  it("returns null for primitives and null input", () => {
    expect(extractDriveIndexList(null)).toBeNull();
    expect(extractDriveIndexList(undefined)).toBeNull();
    expect(extractDriveIndexList("oops")).toBeNull();
    expect(extractDriveIndexList(42)).toBeNull();
  });
});

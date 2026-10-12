import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractDriveIndexList, listDriveFiles, loadDriveFileBytes } from "../reader";
import type { DriveIndexEntry } from "../reader";
import type { SharedRecord } from "../sharedBus";
import { encryptFixture } from "./encryptedFixture";

vi.mock("../../mistNode", () => ({ ensureMistNode: vi.fn(async () => {}) }));
vi.mock("../../../vendor/mistlib/wrappers/web/index.js", () => ({ storage_get: vi.fn() }));
vi.mock("../sharedBus", () => ({ readShared: vi.fn() }));

import { ensureMistNode } from "../../mistNode";
import { storage_get } from "../../../vendor/mistlib/wrappers/web/index.js";
import { readShared } from "../sharedBus";

describe("extractDriveIndexList", () => {
  it("returns the array as-is for a bare DriveIndexEntry[] payload", () => {
    const parsed = [{ id: "1" }, { id: "2" }];
    expect(extractDriveIndexList(parsed)).toBe(parsed);
  });

  it("unwraps `.files` for a {version, updatedAt, files} payload (legacy plaintext writer)", () => {
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

const entry: DriveIndexEntry = {
  id: "avatar-1", name: "Avatar.VRM", mimeType: "model/vrm", size: 3,
  lastCid: "cid-file", path: "Avatars", passphrase: "file-key-for-test",
};
const index = { version: 1, updatedAt: "2026-10-12T00:00:00.000Z", files: [entry, { id: "invalid" }] };
const indexKey = "same-origin-index-key-for-test";
const encryptedMeta = { format: "tc-storage/drive-index/encrypted/1", indexKey, count: 1, updatedAt: index.updatedAt };

function publishRecord(meta: SharedRecord["meta"] = {}, cid = "cid-index") {
  vi.mocked(readShared).mockReturnValue({ from: "tc-storage", cid, updatedAt: index.updatedAt, meta });
}
function serve(value: unknown) {
  vi.mocked(storage_get).mockResolvedValue(new TextEncoder().encode(JSON.stringify(value)));
}

beforeEach(() => vi.resetAllMocks());

describe("listDriveFiles", () => {
  it.each(["HKDF-SHA256", "PBKDF2-SHA256"] as const)("decrypts a wrapped %s CID index and filters valid entries/extensions", async (kdf) => {
    const envelope = await encryptFixture(index, indexKey, kdf);
    expect(JSON.stringify(envelope)).not.toContain(entry.passphrase);
    expect(JSON.stringify(envelope)).not.toContain(indexKey);
    publishRecord(encryptedMeta);
    serve(envelope);
    expect(await listDriveFiles({ extensions: [".vrm"] })).toEqual([entry]);
    expect(await listDriveFiles({ extensions: [".png"] })).toEqual([]);
    expect(vi.mocked(readShared).mock.calls).toEqual([["drive-index"], ["drive-index"]]);
    expect(vi.mocked(ensureMistNode).mock.calls).toEqual([[], []]);
    // The same-origin key is used locally; storage receives only the CID.
    expect(vi.mocked(storage_get).mock.calls).toEqual([["cid-index"], ["cid-index"]]);
  });

  it.each([undefined, "", "   ", 42])("returns [] without fetching when the encrypted index key is %s", async (key) => {
    publishRecord({ ...encryptedMeta, indexKey: key });
    expect(await listDriveFiles()).toEqual([]);
    expect(ensureMistNode).not.toHaveBeenCalled();
    expect(storage_get).not.toHaveBeenCalled();
  });

  it("returns [] when the index key is wrong", async () => {
    publishRecord({ ...encryptedMeta, indexKey: "wrong-key" });
    serve(await encryptFixture(index, indexKey));
    expect(await listDriveFiles()).toEqual([]);
    expect(storage_get).toHaveBeenCalledExactlyOnceWith("cid-index");
  });

  it("does not fall back to plaintext when a CID is marked encrypted", async () => {
    publishRecord(encryptedMeta);
    serve(index);
    expect(await listDriveFiles()).toEqual([]);
  });

  it("reads legacy inline metadata without fetching its CID", async () => {
    publishRecord(index);
    expect(await listDriveFiles()).toEqual([entry]);
    expect(storage_get).not.toHaveBeenCalled();
    expect(ensureMistNode).not.toHaveBeenCalled();
  });

  it("reads a legacy plaintext wrapped CID", async () => {
    publishRecord({ count: 1, updatedAt: index.updatedAt });
    serve(index);
    expect(await listDriveFiles()).toEqual([entry]);
    expect(storage_get).toHaveBeenCalledExactlyOnceWith("cid-index");
  });

  it("reads a legacy bare-array CID", async () => {
    publishRecord(undefined);
    serve(index.files);
    expect(await listDriveFiles()).toEqual([entry]);
  });

  it("returns [] for an absent record, missing CID, malformed JSON, or failed fetch", async () => {
    vi.mocked(readShared).mockReturnValue(null);
    expect(await listDriveFiles()).toEqual([]);
    publishRecord({}, "");
    expect(await listDriveFiles()).toEqual([]);
    expect(storage_get).not.toHaveBeenCalled();
    publishRecord({});
    vi.mocked(storage_get).mockResolvedValue(new TextEncoder().encode("invalid JSON"));
    expect(await listDriveFiles()).toEqual([]);
    vi.mocked(storage_get).mockRejectedValue(new Error("unavailable"));
    expect(await listDriveFiles()).toEqual([]);
  });
});

describe("loadDriveFileBytes", () => {
  it.each(["HKDF-SHA256", "PBKDF2-SHA256"] as const)("loads a %s FileBundle using its file key", async (kdf) => {
    serve(await encryptFixture({ file: { dataUrl: "data:application/octet-stream;base64,AQID" } }, entry.passphrase, kdf));
    expect(await loadDriveFileBytes(entry)).toEqual(new Uint8Array([1, 2, 3]));
    expect(storage_get).toHaveBeenCalledExactlyOnceWith(entry.lastCid);
  });
});

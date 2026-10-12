import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../crypto";
import type { EncryptedPayload } from "../crypto";
import { encryptFixture } from "./encryptedFixture";

const passphrase = "crypto-test-key";
const value = { file: { name: "avatar.vrm", dataUrl: "data:application/octet-stream;base64,AQID" } };
const minimalEnvelope: EncryptedPayload = {
  version: 1, algorithm: "AES-GCM", kdf: "HKDF-SHA256", iterations: 0,
  salt: btoa("s".repeat(16)), iv: btoa("i".repeat(12)), cipherText: btoa("c".repeat(16)),
};

describe("encrypted bundle compatibility", () => {
  it("keeps emitting PBKDF2-SHA256 envelopes with 210000 iterations", async () => {
    const envelope = await encryptJson(value, passphrase);
    expect(envelope.kdf).toBe("PBKDF2-SHA256");
    expect(envelope.iterations).toBe(210000);
    expect(await decryptJson(envelope, passphrase)).toEqual(value);
  });

  it("decrypts an independently produced HKDF-SHA256 envelope with empty info", async () => {
    const envelope = await encryptFixture(value, passphrase);
    expect(await decryptJson(envelope, passphrase)).toEqual(value);
  });

  it.each([100000, 1000000])("accepts the PBKDF2 boundary of %i iterations", async (iterations) => {
    const envelope = await encryptFixture(value, passphrase, "PBKDF2-SHA256", iterations);
    expect(await decryptJson(envelope, passphrase)).toEqual(value);
  });

  it.each([99999, 1000001, 0, -1, 210000.5, NaN, Infinity])("rejects PBKDF2 iterations=%s", async (iterations) => {
    await expect(decryptJson({ ...minimalEnvelope, kdf: "PBKDF2-SHA256", iterations }, passphrase))
      .rejects.toThrow("invalid encryption parameters");
  });

  it.each([-1, 1, 210000, 0.5, NaN, Infinity])("rejects HKDF iterations=%s", async (iterations) => {
    await expect(decryptJson({ ...minimalEnvelope, iterations }, passphrase))
      .rejects.toThrow("invalid encryption parameters");
  });

  it.each([
    { salt: btoa("s".repeat(15)) }, { salt: btoa("s".repeat(17)) },
    { iv: btoa("i".repeat(11)) }, { iv: btoa("i".repeat(13)) }, { cipherText: "" },
    { salt: "!invalid-base64!" }, { salt: null }, { iv: 12 }, { cipherText: null },
    { iterations: "0" }, { iterations: undefined },
  ])("rejects invalid envelope parameters %j", async (patch) => {
    await expect(decryptJson({ ...minimalEnvelope, ...patch } as EncryptedPayload, passphrase)).rejects.toThrow();
  });

  it.each([null, { ...minimalEnvelope, version: 2 }, { ...minimalEnvelope, algorithm: "AES-CBC" },
    { ...minimalEnvelope, kdf: "unknown" }])("rejects unsupported envelope %j", async (payload) => {
    await expect(decryptJson(payload as EncryptedPayload, passphrase)).rejects.toThrow("unsupported encrypted payload format");
  });

  it("rejects empty keys, wrong keys and authenticated ciphertext corruption", async () => {
    const envelope = await encryptFixture(value, passphrase);
    await expect(decryptJson(envelope, "   ")).rejects.toThrow("a decryption passphrase is required");
    await expect(decryptJson(envelope, "wrong-key")).rejects.toThrow();
    const bytes = atob(envelope.cipherText);
    const corrupted = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    await expect(decryptJson({ ...envelope, cipherText: corrupted }, passphrase)).rejects.toThrow();
  });
});

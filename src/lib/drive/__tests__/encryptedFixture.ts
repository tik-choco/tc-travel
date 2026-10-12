import type { EncryptedPayload } from "../crypto";

// Independent Web Crypto producer: mirrors the envelope wire contract without
// calling the consumer's key derivation or encryption implementation.
export async function encryptFixture(
  value: unknown,
  passphrase: string,
  kdf: EncryptedPayload["kdf"] = "HKDF-SHA256",
  iterations = kdf === "HKDF-SHA256" ? 0 : 210000,
): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algorithm = kdf === "HKDF-SHA256" ? "HKDF" : "PBKDF2";
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(passphrase.trim()), algorithm, false, ["deriveKey"]);
  const params = algorithm === "HKDF"
    ? { name: algorithm, hash: "SHA-256", salt, info: new Uint8Array(0) }
    : { name: algorithm, hash: "SHA-256", salt, iterations };
  const key = await crypto.subtle.deriveKey(params, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const cipherText = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return { version: 1, algorithm: "AES-GCM", kdf, iterations,
    salt: base64(salt), iv: base64(iv), cipherText: base64(new Uint8Array(cipherText)) };
}

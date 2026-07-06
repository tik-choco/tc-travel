// Ported from tc-storage's src/crypto/crypto.ts + src/crypto/cryptoEncoding.ts.
// Output format must stay byte-compatible with tc-storage so it can decrypt
// what tc-travel writes (and vice versa): AES-GCM 256, PBKDF2-SHA256 with
// 210000 iterations, 16-byte salt, 12-byte iv, base64-encoded fields. See
// docs/INTEGRATION.md.
export type AesGcmPayload = {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  cipherText: string;
};

export type EncryptedPayload = AesGcmPayload;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const webCryptoIterations = 210000;
const minWebCryptoIterations = 100000;
const maxWebCryptoIterations = 1000000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 24 random bytes, base64url-encoded — same format as tc-storage's
 *  crypto/folderKeys.ts generateFolderKey(), used here for the TC Travel
 *  folder's passphrase so it decrypts under tc-storage's own folder-key flow. */
export function generateFolderKey(): string {
  const bytes = new Uint8Array(24);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("tc-travel: secure random generation is unavailable for folder key generation");
  }
  cryptoApi.getRandomValues(bytes);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function encryptJson(value: unknown, passphrase: string): Promise<EncryptedPayload> {
  const phrase = passphrase.trim();
  if (!phrase) throw new Error("tc-travel: an encryption passphrase is required");
  if (!hasSubtleCrypto()) throw new Error("tc-travel: encryption requires the Web Crypto API (HTTPS or localhost)");
  const encoded = encoder.encode(JSON.stringify(value));
  return encryptAesGcm(encoded, phrase);
}

export async function decryptJson<T>(payload: EncryptedPayload, passphrase: string): Promise<T> {
  const phrase = passphrase.trim();
  if (!phrase) throw new Error("tc-travel: a decryption passphrase is required");
  validateAesGcmPayload(payload);
  const decrypted = await decryptAesGcm(payload, phrase);
  return JSON.parse(decoder.decode(decrypted)) as T;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await subtleCrypto().digest("SHA-256", toArrayBuffer(bytes));
  return hex(new Uint8Array(digest));
}

async function encryptAesGcm(data: Uint8Array, passphrase: string): Promise<AesGcmPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveWebCryptoKey(passphrase, salt);
  const encrypted = await subtleCrypto().encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(data));
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: webCryptoIterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipherText: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptAesGcm(payload: AesGcmPayload, passphrase: string): Promise<Uint8Array> {
  if (!hasSubtleCrypto()) {
    throw new Error("tc-travel: this data is AES-GCM encrypted; decryption requires the Web Crypto API (HTTPS or localhost)");
  }
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const cipherText = base64ToBytes(payload.cipherText);
  const key = await deriveWebCryptoKey(passphrase, salt, payload.iterations);
  const decrypted = await subtleCrypto().decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(cipherText));
  return new Uint8Array(decrypted);
}

function validateAesGcmPayload(payload: unknown): asserts payload is AesGcmPayload {
  if (!payload || typeof payload !== "object") throw new Error("tc-travel: unsupported encrypted payload format");
  const value = payload as Partial<AesGcmPayload>;
  if (typeof value.salt !== "string" || typeof value.iv !== "string" || typeof value.cipherText !== "string") {
    throw new Error("tc-travel: invalid encryption parameters");
  }
  if (value.version !== 1) throw new Error("tc-travel: unsupported encrypted payload format");
  if (value.algorithm !== "AES-GCM") throw new Error("tc-travel: unsupported encrypted payload format");
  if (value.kdf !== "PBKDF2-SHA256") throw new Error("tc-travel: unsupported encrypted payload format");
  const iterations = value.iterations;
  if (typeof iterations !== "number" || !Number.isInteger(iterations) || iterations < minWebCryptoIterations || iterations > maxWebCryptoIterations) {
    throw new Error("tc-travel: invalid encryption parameters");
  }

  const salt = base64ToBytes(value.salt);
  const iv = base64ToBytes(value.iv);
  const cipherText = base64ToBytes(value.cipherText);
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || cipherText.byteLength === 0) {
    throw new Error("tc-travel: invalid encryption parameters");
  }
}

async function deriveWebCryptoKey(passphrase: string, salt: Uint8Array, iterationCount = webCryptoIterations): Promise<CryptoKey> {
  const passphraseBytes = encoder.encode(passphrase);
  const baseKey = await subtleCrypto().importKey("raw", toArrayBuffer(passphraseBytes), "PBKDF2", false, ["deriveKey"]);
  return subtleCrypto().deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: iterationCount, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function randomBytes(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("tc-travel: secure random generation is unavailable for encryption");
  }
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function hasSubtleCrypto(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("tc-travel: Web Crypto API is unavailable");
  return subtle;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

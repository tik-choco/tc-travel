// QR encode/parse for the face-to-face card exchange (see types.ts's Card).
// A card QR reads `tctravel-card:1:<base64url(JSON)>` — deliberately distinct
// from room-join QRs (full `#/join/<roomId>` URLs, see qr.ts), so pointing
// the card scanner at a room code (or vice versa) parses to null instead of
// misfiring. The payload is untrusted scanned input: parseCard() shape-checks
// every field, clamping the cosmetic ones and rejecting only structural rot,
// and never throws.
import type { Card } from "./types";

const PREFIX = "tctravel-card:1:";

const ID_MAX = 64;
const NAME_MAX = 80;
const EMOJI_MAX = 16;
const MESSAGE_MAX = 300;
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

const FALLBACK_NAME = "Anonymous";
const FALLBACK_EMOJI = "\u{1F9ED}"; // compass — matches Avatar.tsx's fallback
const FALLBACK_COLOR = "#888888";

/** UTF-8 → base64url. btoa() only accepts latin-1, so the text goes through
 *  TextEncoder into a binary string first (names/messages are often CJK). */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url → UTF-8. Throws on malformed base64 — parseCard catches. */
function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Renders a card as QR text. `receivedAt` is the scanner's local field and
 *  never travels — the receiver stamps their own on receipt (cards.ts). */
export function encodeCard(card: Card): string {
  const { id, name, avatarEmoji, color, message, at } = card;
  return PREFIX + toBase64Url(JSON.stringify({ id, name, avatarEmoji, color, message, at }));
}

/** Decodes scanned QR text back into a card, or null for anything that isn't
 *  a structurally sound card QR (wrong prefix, bad base64/JSON, unusable id).
 *  Cosmetic fields are clamped/defaulted rather than rejected — a slightly
 *  mangled card is still a keepsake; a forged shape is not. */
export function parseCard(text: string): Omit<Card, "receivedAt"> | null {
  if (!text.startsWith(PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(text.slice(PREFIX.length)));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // id is the sender identity and the collection's dedupe key — a card
  // without a sane one is not salvageable.
  const id = obj.id;
  if (typeof id !== "string" || id.length < 1 || id.length > ID_MAX) return null;

  const name =
    typeof obj.name === "string" && obj.name.trim() !== ""
      ? obj.name.trim().slice(0, NAME_MAX)
      : FALLBACK_NAME;
  // Oversized "emoji" is replaced, not sliced — slicing mid-glyph would split
  // surrogate pairs / ZWJ sequences into mojibake.
  const avatarEmoji =
    typeof obj.avatarEmoji === "string" && obj.avatarEmoji !== "" && obj.avatarEmoji.length <= EMOJI_MAX
      ? obj.avatarEmoji
      : FALLBACK_EMOJI;
  // The color lands in inline styles, so anything but a strict hex literal is discarded.
  const color = typeof obj.color === "string" && COLOR_PATTERN.test(obj.color) ? obj.color : FALLBACK_COLOR;
  const message = typeof obj.message === "string" ? obj.message.slice(0, MESSAGE_MAX) : "";
  const at = typeof obj.at === "number" && Number.isFinite(obj.at) ? obj.at : Date.now();

  return { id, name, avatarEmoji, color, message, at };
}

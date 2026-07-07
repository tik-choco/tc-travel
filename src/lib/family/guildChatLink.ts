// Cross-app interop for the tik-choco family: lets the Guild screen open a
// matching real-time chat room in the family's chat app WITHOUT any data
// hand-off — no shared bus topic, no localStorage peeking. The chat app
// hashes whatever room id it's given into its own private swarm topic
// (see its src/lib/util.ts channelIdFor, "tcch-" prefixed for exactly this
// reason: coexisting with other apps on the shared mistlib network) before
// it ever touches the wire, and this app never joins that swarm itself —
// the two apps trade zero bytes, they just agree on a plain id string via a
// link. Every party member computes the identical URL from the same room
// id, so the whole party converges on one chat room with no coordination.
const DEFAULT_BASE_PATH = "/tc-chat/";

// The chat app's own room-id pattern is the tighter of the two apps'
// (ROOM_ID_PATTERN, {1,64} vs. this app's {1,128}); clamp to it so a link
// built here can never exceed what its own join screen would accept.
const CHAT_ROOM_ID_MAX_LEN = 64;

function resolveBase(): string {
  const raw = (import.meta.env.VITE_TC_CHAT_URL as string | undefined) ?? "";
  const base = raw.trim() || DEFAULT_BASE_PATH;
  return base.endsWith("/") ? base : `${base}/`;
}

/** Builds a link that opens (or creates) the chat app's room matching this
 *  travel party, pre-filling its display name on first visit via `?name=`. */
export function guildChatUrl(roomId: string, roomName: string): string {
  const base = resolveBase();
  const origin = /^https?:\/\//.test(base) ? "" : location.origin;
  const id = roomId.slice(0, CHAT_ROOM_ID_MAX_LEN);
  const name = roomName.trim();
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  return `${origin}${base}${query}#/${encodeURIComponent(id)}`;
}

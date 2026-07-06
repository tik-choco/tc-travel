// Avatar identity: the profile portrait (Profile.avatarImage, see types.ts) and
// its P2P sharing via mist storage (Member.avatarCid) once a room is live.
// Compression mirrors photo.ts's compressImage, but cover-crops to a square
// first since avatars always render in circular/rounded frames (see
// docs/REDESIGN.md's Avatar identity section); resolution mirrors store.ts's
// usePhotoUrl cid->ObjectURL pattern, with cache eviction since — unlike
// photos — the same member's avatarCid can change repeatedly over a session.
import { useEffect, useState } from "preact/hooks";
import { ensureMistNode } from "./mistNode";
import { storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { updateProfile, useProfile } from "./personal";
import { setMemberAvatarBytes, clearMemberAvatarCid } from "./store";
import type { Member } from "./types";

const AVATAR_MAX_DIM = 256;
const AVATAR_QUALITY = 0.85;

type Drawable = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

async function decodeImage(src: Blob): Promise<{ drawable: Drawable; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(src);
    return { drawable: bitmap, width: bitmap.width, height: bitmap.height };
  }
  // Fallback for browsers without createImageBitmap(Blob) support (older iOS Safari).
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("avatar: failed to decode image"));
      el.src = url;
    });
    return { drawable: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Cover-crops `source` to a square and re-encodes as a small JPEG. Returns
 *  both the data URL (for profile storage) and the same bytes (for mist
 *  storage upload) so the two never drift out of sync. */
async function compressAvatar(source: Blob): Promise<{ dataUrl: string; bytes: Uint8Array }> {
  const { drawable, width, height } = await decodeImage(source);
  const cropSize = Math.min(width, height);
  const sx = (width - cropSize) / 2;
  const sy = (height - cropSize) / 2;
  const outSize = Math.min(AVATAR_MAX_DIM, cropSize);

  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("avatar: 2D canvas context unavailable");
  ctx.drawImage(drawable, sx, sy, cropSize, cropSize, 0, 0, outSize, outSize);
  if (drawable instanceof ImageBitmap) drawable.close();

  const dataUrl = canvas.toDataURL("image/jpeg", AVATAR_QUALITY);
  return { dataUrl, bytes: dataUrlToBytes(dataUrl) };
}

// --- profile mutation --------------------------------------------------

/** Compresses `source` to a ≤256px cover-cropped square JPEG and persists it
 *  as profile.avatarImage. If a room session is live, also uploads the bytes
 *  to mist storage and sets members[profile.id].avatarCid — that upload is
 *  non-fatal (the profile avatar is saved regardless) and logged on failure. */
export async function setProfileAvatar(source: Blob): Promise<void> {
  const { dataUrl, bytes } = await compressAvatar(source);
  updateProfile({ avatarImage: dataUrl });
  try {
    await setMemberAvatarBytes(bytes);
  } catch (err) {
    console.error("tc-travel: failed to sync avatar to room", err);
  }
}

/** Removes the profile avatar image and, if in a room, the local member's avatarCid. */
export function clearProfileAvatar(): void {
  updateProfile({ avatarImage: undefined });
  clearMemberAvatarCid();
}

// --- avatar url resolution -----------------------------------------------

// Avatars (unlike photos) can change repeatedly within a session, so old
// cids can pile up as orphaned cache entries — bound the cache and revoke
// evicted ObjectURLs instead of caching forever like store.ts's photoUrlCache.
const AVATAR_URL_CACHE_MAX = 64;
const avatarUrlCache = new Map<string, string>(); // cid -> ObjectURL, insertion-ordered for LRU eviction

function cacheGet(cid: string): string | undefined {
  const url = avatarUrlCache.get(cid);
  if (url !== undefined) {
    avatarUrlCache.delete(cid);
    avatarUrlCache.set(cid, url); // refresh recency
  }
  return url;
}

function cacheSet(cid: string, url: string): void {
  if (avatarUrlCache.size >= AVATAR_URL_CACHE_MAX) {
    const oldestCid = avatarUrlCache.keys().next().value;
    if (oldestCid !== undefined) {
      URL.revokeObjectURL(avatarUrlCache.get(oldestCid)!);
      avatarUrlCache.delete(oldestCid);
    }
  }
  avatarUrlCache.set(cid, url);
}

const RETRY_DELAYS_MS = [0, 1000, 3000, 9000]; // mirrors store.ts's usePhotoUrl backoff

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ObjectURL for a member's avatar image. For the local member this
 *  short-circuits to profile.avatarImage; for everyone else it resolves
 *  avatarCid from mist storage with an in-memory cache + retry/backoff
 *  (mirrors store.ts's usePhotoUrl). Null means the caller should fall back
 *  to avatarEmoji. */
export function useMemberAvatarUrl(member: Pick<Member, "id" | "avatarCid"> | null): string | null {
  const [profile] = useProfile();
  const isSelf = !!member && member.id === profile.id;
  const remoteCid = isSelf ? undefined : member?.avatarCid;
  const [url, setUrl] = useState<string | null>(remoteCid ? (cacheGet(remoteCid) ?? null) : null);

  useEffect(() => {
    if (!remoteCid) {
      setUrl(null);
      return;
    }
    const cached = cacheGet(remoteCid);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    setUrl(null);
    void (async () => {
      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) await sleep(delay);
        if (cancelled) return;
        try {
          await ensureMistNode();
          const bytes = await storage_get(remoteCid);
          const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
          cacheSet(remoteCid, objectUrl);
          if (!cancelled) setUrl(objectUrl);
          return;
        } catch {
          // retry per RETRY_DELAYS_MS; give up silently after the last attempt
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteCid]);

  if (isSelf) return profile.avatarImage ?? null;
  return url;
}

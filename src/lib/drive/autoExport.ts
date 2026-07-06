// Automatic album -> drive export: every photo in the room (own and peers')
// lands in the shared drive folder without pressing PhotoViewer's manual
// "save to drive" button. Driven from app.tsx off the reactive photo list;
// exportPhotoToDrive itself serializes concurrent calls and records exported
// ids, so this layer only has to decide which photos to attempt.
import { ensureMistNode } from "../mistNode";
import { storage_get } from "../../vendor/mistlib/wrappers/web/index.js";
import { exportPhotoToDrive, isPhotoExported } from "./export";
import type { Photo } from "../types";

// Per-session attempt guard: a photo whose export failed (typically a peer's
// bytes not fetchable yet) is NOT retried within this session — it stays
// unexported and gets another attempt on the next app start, instead of
// hammering the network every time the photo list re-renders.
const attempted = new Set<string>();

export function autoExportPhotos(photos: Photo[]): void {
  for (const photo of photos) {
    if (attempted.has(photo.id) || isPhotoExported(photo.id)) continue;
    attempted.add(photo.id);
    void (async () => {
      try {
        await ensureMistNode();
        const raw = await storage_get(photo.cid);
        await exportPhotoToDrive({
          photoId: photo.id,
          bytes: new Uint8Array(raw),
          caption: photo.caption ?? "",
          at: photo.at,
        });
      } catch (err) {
        console.warn("tc-travel: auto drive export failed", photo.id, err);
      }
    })();
  }
}

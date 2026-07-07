import { useEffect, useRef, useState } from "preact/hooks";
import { Camera, ImagePlus, LoaderCircle, Trash2, X } from "lucide-preact";
import { addPhotoAuto } from "../../lib/memories";
import { compressImage } from "../../lib/photo";
import { lookupCountry } from "../../lib/geo";
import { useT } from "../../lib/i18n";
import type { GeoPoint } from "../../lib/types";

type PendingStatus = "compressing" | "locating" | "ready" | "saving" | "done" | "error";

interface PendingPhoto {
  key: string;
  file: File;
  previewUrl: string;
  status: PendingStatus;
  caption: string;
  bytes: Uint8Array | null;
  width: number;
  height: number;
  geo: GeoPoint | null;
}

interface AddPhotoSheetProps {
  onClose: () => void;
}

/** Best-effort one-shot geolocation: 5s timeout, resolves null on deny/timeout
 * instead of rejecting, so callers never need a try/catch. */
function getGeoOnce(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}

export function AddPhotoSheet({ onClose }: AddPhotoSheetProps) {
  const t = useT();
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // Blob preview URLs must outlive individual renders but not the sheet:
  // revoke whatever is still pending when the sheet unmounts (save-all,
  // cancel, or tab switch), not only on per-item removal.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const patch = (key: string, changes: Partial<PendingPhoto>) => {
    setPending((list) => list.map((p) => (p.key === key ? { ...p, ...changes } : p)));
  };

  const processOne = async (item: PendingPhoto) => {
    try {
      const { bytes, width, height } = await compressImage(item.file);
      patch(item.key, { status: "locating", bytes, width, height });
      const pos = await getGeoOnce();
      let geo: GeoPoint | null = null;
      if (pos) {
        const countryCode = await lookupCountry(pos.coords.latitude, pos.coords.longitude);
        geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, countryCode };
      }
      patch(item.key, { status: "ready", geo });
    } catch {
      patch(item.key, { status: "error" });
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: PendingPhoto[] = Array.from(files).map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "compressing",
      caption: "",
      bytes: null,
      width: 0,
      height: 0,
      geo: null,
    }));
    setPending((list) => [...list, ...items]);
    for (const item of items) void processOne(item);
  };

  const removePending = (key: string) => {
    setPending((list) => {
      const item = list.find((p) => p.key === key);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return list.filter((p) => p.key !== key);
    });
  };

  const hasReady = pending.some((p) => p.status === "ready");
  const isSaving = pending.some((p) => p.status === "saving");

  const handleSaveAll = async () => {
    const ready = pending.filter((p) => p.status === "ready" && p.bytes);
    for (const item of ready) {
      patch(item.key, { status: "saving" });
      try {
        // Routes to the room Y.Doc when in a party, else the local solo store —
        // capture works with or without peers.
        await addPhotoAuto(item.bytes as Uint8Array, {
          caption: item.caption.trim(),
          geo: item.geo,
          width: item.width,
          height: item.height,
          arShot: false,
        });
        patch(item.key, { status: "done" });
      } catch {
        patch(item.key, { status: "error" });
      }
    }
    onClose();
  };

  const statusLabel = (status: PendingStatus) => {
    switch (status) {
      case "compressing":
        return t("album.status.compressing");
      case "locating":
        return t("album.status.locating");
      case "ready":
        return t("album.status.ready");
      case "saving":
        return t("album.status.saving");
      case "done":
        return t("album.status.ready");
      case "error":
        return t("album.status.error");
    }
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-card sheet">
        <div class="sheet-handle" />
        <h2 class="sheet-title title-ornate">{t("album.pickerTitle")}</h2>

        <div class="sheet-choice-row">
          <button
            type="button"
            class="btn btn-tonal sheet-choice-btn"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={18} /> {t("album.pickCamera")}
          </button>
          <button
            type="button"
            class="btn btn-tonal sheet-choice-btn"
            onClick={() => filesInputRef.current?.click()}
          >
            <ImagePlus size={18} /> {t("album.pickFiles")}
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          class="visually-hidden"
          onChange={(e) => {
            handleFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          accept="image/*"
          multiple
          class="visually-hidden"
          onChange={(e) => {
            handleFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />

        {pending.length > 0 && (
          <ul class="pending-list">
            {pending.map((item) => (
              <li key={item.key} class="pending-item">
                <img src={item.previewUrl} alt="" class="pending-thumb" />
                <div class="pending-body">
                  <input
                    type="text"
                    class="input pending-caption-input"
                    placeholder={t("album.captionPlaceholder")}
                    value={item.caption}
                    disabled={item.status === "saving" || item.status === "done"}
                    onInput={(e) => patch(item.key, { caption: (e.target as HTMLInputElement).value })}
                  />
                  <span class="pending-status-row">
                    {(item.status === "compressing" || item.status === "locating" || item.status === "saving") && (
                      <LoaderCircle class="spin" size={14} />
                    )}
                    {statusLabel(item.status)}
                  </span>
                </div>
                {item.status !== "saving" && item.status !== "done" && (
                  <button
                    type="button"
                    class="pending-remove"
                    onClick={() => removePending(item.key)}
                    aria-label={t("album.removePending")}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div class="sheet-actions">
          <button type="button" class="btn" onClick={onClose} disabled={isSaving}>
            <X size={16} /> {t("album.cancel")}
          </button>
          <button type="button" class="btn btn-primary" onClick={handleSaveAll} disabled={!hasReady || isSaving}>
            {isSaving && <LoaderCircle class="spin" size={16} />} {t("album.saveAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

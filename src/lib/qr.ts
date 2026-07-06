// QR generation (qrcode) + scanning (BarcodeDetector, jsQR fallback) for
// room sharing. Room link format: `<origin><base>#/join/<roomId>` — the QR
// encodes the full URL so any phone camera app can open it directly; the
// in-app scanner extracts just the roomId (see parseJoinInput).
import QRCode from "qrcode";
import jsQR from "jsqr";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const JOIN_HASH = "#/join/";

export async function renderQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: "H",
    color: { dark: "#2b1d0e", light: "#f0e2c4" },
  });
}

export function buildJoinUrl(roomId: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${location.origin}${base}${JOIN_HASH.slice(1)}${roomId}`;
}

/** Accepts a full join URL (containing "#/join/<roomId>") or a bare valid roomId; null if neither parses. */
export function parseJoinInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const hashIdx = trimmed.indexOf(JOIN_HASH);
  const candidate = hashIdx >= 0 ? trimmed.slice(hashIdx + JOIN_HASH.length) : trimmed;
  return ROOM_ID_PATTERN.test(candidate) ? candidate : null;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

/**
 * Starts scanning `video`'s frames for a QR code, calling `onResult` for
 * each decoded payload. Prefers the native BarcodeDetector (Chrome/Android);
 * falls back to jsQR over offscreen canvas frames at ~10fps (iOS Safari,
 * which lacks BarcodeDetector). The returned stop() only cancels the scan
 * loop — it does not own or stop the video element's media stream.
 */
export function startQrScan(video: HTMLVideoElement, onResult: (text: string) => void): () => void {
  const BarcodeDetectorImpl = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

  if (BarcodeDetectorImpl) {
    const detector = new BarcodeDetectorImpl({ formats: ["qr_code"] });
    let stopped = false;
    let frameHandle: number | null = null;
    const tick = () => {
      if (stopped) return;
      detector
        .detect(video)
        .then((codes) => {
          if (codes.length > 0) onResult(codes[0].rawValue);
        })
        .catch(() => {
          // transient detection errors (e.g. video not ready yet) are expected; keep scanning
        })
        .finally(() => {
          if (!stopped) frameHandle = requestAnimationFrame(tick);
        });
    };
    frameHandle = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const intervalId = setInterval(() => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!ctx || !width || !height) return;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    const code = jsQR(frame.data, width, height);
    if (code) onResult(code.data);
  }, 100);
  return () => clearInterval(intervalId);
}

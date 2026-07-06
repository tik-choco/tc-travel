// Capture/import compression: canvas-resize to a max dimension, re-encode as
// JPEG. Used both by the album's file-import flow and the AR camera's
// capture flow (see docs/DESIGN.md's photo compression spec: max 1280px,
// quality 0.8, target <= ~200KB so photos are cheap to carry as Y.Doc
// metadata + mist storage blobs).

type Drawable = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

async function toDrawable(src: Blob | HTMLCanvasElement): Promise<{ drawable: Drawable; width: number; height: number }> {
  if (src instanceof HTMLCanvasElement) {
    return { drawable: src, width: src.width, height: src.height };
  }
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(src);
    return { drawable: bitmap, width: bitmap.width, height: bitmap.height };
  }
  // Fallback for browsers without createImageBitmap(Blob) support (older
  // iOS Safari) — decode via a plain <img> element instead.
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("compressImage: failed to decode image"));
      el.src = url;
    });
    return { drawable: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(
  src: Blob | HTMLCanvasElement,
  maxDim = 1280,
  quality = 0.8,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { drawable, width: srcWidth, height: srcHeight } = await toDrawable(src);
  const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("compressImage: 2D canvas context unavailable");
  ctx.drawImage(drawable, 0, 0, width, height);
  if (drawable instanceof ImageBitmap) drawable.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("compressImage: canvas.toBlob failed"))), "image/jpeg", quality);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, width, height };
}

// Shared canvas primitives + export flow (Web Share Level 2 / download) for
// the 自慢カード family — BragCard.tsx (Japan prefectures) and
// WorldBragCard.tsx (world countries) both draw a 1080x1350 portrait image
// with the same frame, header, stats block and footer, then hand the result
// off to the same share-or-download action. Extracted so the two cards can
// never drift in tone/behaviour; each still owns its own map-drawing code,
// since that's the one part that's genuinely different between them.
import { useEffect, useRef, useState } from "preact/hooks";
import type { MutableRef } from "preact/hooks";
import { getLanguage } from "../../lib/i18n";

// 4:5 portrait — tall maps (Japan) and feeds people brag on both want this.
export const CARD_W = 1080;
export const CARD_H = 1350;

/** Resolves a design token at draw time so the exported image follows the
 *  active theme — canvas can't read var(--...) on its own. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
}

/** Background gradient + the double rounded-rect journal frame every brag
 *  card opens with. */
export function drawCardFrame(ctx: CanvasRenderingContext2D): void {
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, token("--surface"));
  bg.addColorStop(1, token("--surface-dim"));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.strokeStyle = token("--outline-variant");
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(28, 28, CARD_W - 56, CARD_H - 56, 40);
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = token("--gold");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(42, 42, CARD_W - 84, CARD_H - 84, 32);
  ctx.stroke();
  ctx.restore();
}

/** Title + traveller name, centered at the top — same position on every card. */
export function drawCardHeader(ctx: CanvasRenderingContext2D, font: string, title: string, traveller: string): void {
  ctx.textAlign = "center";
  ctx.fillStyle = token("--on-surface");
  ctx.font = `700 58px ${font}`;
  ctx.fillText(title, CARD_W / 2, 140, CARD_W - 160);
  ctx.fillStyle = token("--on-surface-variant");
  ctx.font = `500 36px ${font}`;
  ctx.fillText(traveller, CARD_W / 2, 200, CARD_W - 200);
}

/** Big "count / total" + a subtitle line + the primary-to-gold progress bar.
 *  Anchored at `y` (typically just below the map); returns the bar's y so
 *  callers can stack more content (badges, continent chips) beneath it. */
export function drawStatsAndBar(
  ctx: CanvasRenderingContext2D,
  font: string,
  y: number,
  count: number,
  total: number,
  exactPct: number,
  subtitle: string,
): number {
  ctx.textAlign = "center";
  ctx.fillStyle = token("--primary");
  ctx.font = `800 92px ${font}`;
  ctx.fillText(`${count} / ${total}`, CARD_W / 2, y);
  ctx.fillStyle = token("--on-surface-variant");
  ctx.font = `500 38px ${font}`;
  ctx.fillText(subtitle, CARD_W / 2, y + 58, CARD_W - 160);

  const barW = 680;
  const barX = (CARD_W - barW) / 2;
  const barY = y + 88;
  ctx.fillStyle = token("--surface-container-high");
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, 14, 7);
  ctx.fill();
  if (count > 0) {
    const fillW = Math.max((exactPct / 100) * barW, 14);
    const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    fill.addColorStop(0, token("--primary"));
    fill.addColorStop(1, token("--gold"));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(barX, barY, fillW, 14, 7);
    ctx.fill();
  }
  return barY;
}

/** A centered row of gold pill labels (Japan's top badges, the world card's
 *  top continents) — same visual treatment, just fed different strings. */
export function drawPillRow(ctx: CanvasRenderingContext2D, font: string, y: number, labels: string[]): void {
  if (labels.length === 0) return;
  ctx.textAlign = "center";
  ctx.font = `600 30px ${font}`;
  const padX = 26;
  const gap = 16;
  const widths = labels.map((label) => ctx.measureText(label).width + padX * 2);
  let x = (CARD_W - (widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1))) / 2;
  for (let i = 0; i < labels.length; i++) {
    ctx.fillStyle = token("--primary-container");
    ctx.beginPath();
    ctx.roundRect(x, y - 36, widths[i], 52, 26);
    ctx.fill();
    ctx.fillStyle = token("--on-primary-container");
    ctx.fillText(labels[i], x + widths[i] / 2, y, widths[i] - padX);
    x += widths[i] + gap;
  }
}

/** Footer credit line, same for every card. */
export function drawCardFooter(ctx: CanvasRenderingContext2D, font: string): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = token("--on-surface-variant");
  ctx.font = `500 26px ${font}`;
  ctx.fillText(`tc-travel · ${new Date().toLocaleDateString(getLanguage())}`, CARD_W / 2, CARD_H - 64);
  ctx.restore();
}

/** Draws to a canvas ref whenever a dep changes (once `ready`) and keeps a
 *  PNG blob of the result in state for share/download. `ready` gates drawing
 *  until whatever data `draw` needs (geometry, etc.) has actually loaded. */
export function useBragCanvas(
  draw: (canvas: HTMLCanvasElement) => void,
  ready: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deps array is spread into useEffect's, whose shape callers control
  deps: readonly any[],
): { canvasRef: MutableRef<HTMLCanvasElement | null>; blob: Blob | null } {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    draw(canvas);
    canvas.toBlob((b) => setBlob(b), "image/png");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller-supplied dependency list
  }, deps);

  return { canvasRef, blob };
}

/** Triggers a browser download of the given PNG blob. */
export function downloadBragImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Web Share Level 2 (with files) when available, falling back to a plain
 *  download — shared by every brag card so a share failure/unsupported
 *  browser degrades identically everywhere. */
export async function shareOrDownloadBragImage(blob: Blob, filename: string, title: string): Promise<void> {
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      if ((err as DOMException | null)?.name === "AbortError") return; // user changed their mind
      // fall through — some browsers advertise share but fail on files
    }
  }
  downloadBragImage(blob, filename);
}

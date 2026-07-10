import { CARD_W, CARD_H, token, drawCardFooter } from "../map/bragCardCanvas";

export { CARD_W, CARD_H };

export interface CardImageInput {
  name: string;
  avatarEmoji: string;
  color: string;
  message: string;
  metOnLabel?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => `${c}${c}`).join("") : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [136, 136, 136];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function mixHex(hexA: string, hexB: string, ratioA: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const r = Math.round(r1 * ratioA + r2 * (1 - ratioA));
  const g = Math.round(g1 * ratioA + g2 * (1 - ratioA));
  const b = Math.round(b1 * ratioA + b2 * (1 - ratioA));
  return `rgb(${r}, ${g}, ${b})`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const ch of paragraph) {
      const candidate = line + ch;
      if (line !== "" && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    if (line !== "") lines.push(line);
  }
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string {
  let truncated = line;
  while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function drawCardImage(ctx: CanvasRenderingContext2D, input: CardImageInput): void {
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const surface = token("--surface");
  const onSurface = token("--on-surface");
  const onSurfaceVariant = token("--on-surface-variant");
  const outlineVariant = token("--outline-variant");
  const cardColor = input.color;
  const centerX = CARD_W / 2;

  ctx.clearRect(0, 0, CARD_W, CARD_H);

  const bg = ctx.createLinearGradient(0, 0, CARD_W * 0.35, CARD_H);
  bg.addColorStop(0, mixHex(cardColor, surface, 0.16));
  bg.addColorStop(1, surface);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.strokeStyle = mixHex(cardColor, outlineVariant, 0.6);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(36, 36, CARD_W - 72, CARD_H - 72, 48);
  ctx.stroke();

  const avatarY = 320;
  const avatarR = 150;
  ctx.beginPath();
  ctx.arc(centerX, avatarY, avatarR, 0, Math.PI * 2);
  ctx.fillStyle = mixHex(cardColor, surface, 0.2);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = cardColor;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `170px ${font}`;
  ctx.fillText(input.avatarEmoji, centerX, avatarY);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = onSurface;
  ctx.font = `700 66px ${font}`;
  const nameY = avatarY + avatarR + 110;
  ctx.fillText(input.name, centerX, nameY, CARD_W - 200);

  let cursorY = nameY + 74;
  if (input.message !== "") {
    ctx.font = `500 40px ${font}`;
    ctx.fillStyle = onSurface;
    const maxWidth = CARD_W - 220;
    const lineHeight = 58;
    const maxLines = 8;
    let lines = wrapLines(ctx, input.message, maxWidth);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxWidth);
    }
    for (const line of lines) {
      ctx.fillText(line, centerX, cursorY, maxWidth);
      cursorY += lineHeight;
    }
  }

  if (input.metOnLabel) {
    const metY = CARD_H - 150;
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = mixHex(cardColor, outlineVariant, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(120, metY - 46);
    ctx.lineTo(CARD_W - 120, metY - 46);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = onSurfaceVariant;
    ctx.font = `500 34px ${font}`;
    ctx.fillText(input.metOnLabel, centerX, metY, CARD_W - 200);
  }

  drawCardFooter(ctx, font);
}

export function renderCardImage(input: CardImageInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("tc-travel: 2d canvas context unavailable"));
  drawCardImage(ctx, input);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("tc-travel: card canvas toBlob failed"));
      },
      "image/jpeg",
      0.92,
    );
  });
}

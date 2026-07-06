import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Download, Share2, X } from "lucide-preact";
import { getLanguage, useT, translate } from "../../lib/i18n";
import { useProfile } from "../../lib/personal";
import { buildJapanLayout, useJapanCollection, type Prefecture } from "./japanGeo";
import { badgeLabel, completionStats, earnedBadges } from "./collection";
import "./map.i18n";
import "./map.css";

// 4:5 portrait — Japan is tall, and so are the feeds people brag on.
const CARD_W = 1080;
const CARD_H = 1350;
const TOP_BADGES = 3;

/** Resolves a design token at draw time so the exported image follows the
 *  active theme — canvas can't read var(--...) on its own. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
}

function drawBragCard(
  canvas: HTMLCanvasElement,
  prefs: Prefecture[],
  visited: ReadonlySet<string>,
  traveller: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const stats = completionStats(visited);

  // --- background + journal frame ---------------------------------------
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

  // --- title + traveller --------------------------------------------------
  ctx.textAlign = "center";
  ctx.fillStyle = token("--on-surface");
  ctx.font = `700 58px ${font}`;
  ctx.fillText(translate("map.brag.title"), CARD_W / 2, 140, CARD_W - 160);
  ctx.fillStyle = token("--on-surface-variant");
  ctx.font = `500 36px ${font}`;
  ctx.fillText(traveller, CARD_W / 2, 200, CARD_W - 200);

  // --- the map -------------------------------------------------------------
  const layout = buildJapanLayout(prefs, 760);
  const scale = Math.min(880 / layout.width, 620 / layout.height);
  ctx.save();
  ctx.translate((CARD_W - layout.width * scale) / 2, 240);
  ctx.scale(scale, scale);
  for (const p of layout.paths) {
    // evenodd matches pointInGeometry's ray-cast, so holes render as holes
    const path = new Path2D(p.d);
    if (visited.has(p.code)) {
      ctx.save();
      ctx.shadowColor = token("--gold");
      ctx.shadowBlur = 14;
      ctx.fillStyle = token("--primary-container");
      ctx.fill(path, "evenodd");
      ctx.restore();
      ctx.strokeStyle = token("--primary");
      ctx.lineWidth = 1.6;
      ctx.stroke(path);
    } else {
      ctx.fillStyle = token("--surface-container-low");
      ctx.fill(path, "evenodd");
      ctx.strokeStyle = token("--outline-variant");
      ctx.lineWidth = 1;
      ctx.stroke(path);
    }
  }
  // Okinawa inset frame
  ctx.strokeStyle = token("--outline-variant");
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(layout.inset.x - 4, layout.inset.y - 4, layout.inset.w + 8, layout.inset.h + 8);
  ctx.setLineDash([]);
  ctx.restore();

  // --- stats ---------------------------------------------------------------
  const statsY = 240 + layout.height * scale + 96;
  ctx.fillStyle = token("--primary");
  ctx.font = `800 92px ${font}`;
  ctx.fillText(`${stats.count} / ${stats.total}`, CARD_W / 2, statsY);
  ctx.fillStyle = token("--on-surface-variant");
  ctx.font = `500 38px ${font}`;
  ctx.fillText(
    translate("map.jp.completion", { count: stats.count, total: stats.total, pct: stats.pct }),
    CARD_W / 2,
    statsY + 58,
    CARD_W - 160,
  );

  // progress bar
  const barW = 680;
  const barX = (CARD_W - barW) / 2;
  const barY = statsY + 88;
  ctx.fillStyle = token("--surface-container-high");
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, 14, 7);
  ctx.fill();
  if (stats.count > 0) {
    const fillW = Math.max((stats.exactPct / 100) * barW, 14);
    const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    fill.addColorStop(0, token("--primary"));
    fill.addColorStop(1, token("--gold"));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(barX, barY, fillW, 14, 7);
    ctx.fill();
  }

  // --- top badges ------------------------------------------------------------
  const top = earnedBadges(visited).slice(0, TOP_BADGES);
  if (top.length > 0) {
    const badgeY = barY + 78;
    const badgeFont = `600 30px ${font}`;
    ctx.font = badgeFont;
    const padX = 26;
    const gap = 16;
    const labels = top.map((id) => badgeLabel(id, translate));
    const widths = labels.map((label) => ctx.measureText(label).width + padX * 2);
    let x = (CARD_W - (widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1))) / 2;
    for (let i = 0; i < labels.length; i++) {
      ctx.fillStyle = token("--primary-container");
      ctx.beginPath();
      ctx.roundRect(x, badgeY - 36, widths[i], 52, 26);
      ctx.fill();
      ctx.fillStyle = token("--on-primary-container");
      ctx.fillText(labels[i], x + widths[i] / 2, badgeY, widths[i] - padX);
      x += widths[i] + gap;
    }
  }

  // --- footer ------------------------------------------------------------------
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = token("--on-surface-variant");
  ctx.font = `500 26px ${font}`;
  ctx.fillText(`tc-travel · ${new Date().toLocaleDateString(getLanguage())}`, CARD_W / 2, CARD_H - 64);
  ctx.restore();
}

interface BragCardProps {
  onClose: () => void;
}

/** The 自慢カード — renders the traveller's Japan collection to a canvas image
 *  they can share (Web Share Level 2) or download. Everything happens locally;
 *  the image never touches a server unless the user shares it somewhere. */
export function BragCard({ onClose }: BragCardProps) {
  const t = useT();
  const lang = getLanguage();
  const [profile] = useProfile();
  const { prefs, visited } = useJapanCollection(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !prefs) return;
    drawBragCard(canvas, prefs, visited, `${profile.avatarEmoji} ${profile.name}`);
    canvas.toBlob((b) => setBlob(b), "image/png");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visitedKey stands in for `visited`
  }, [prefs, visitedKey, lang, profile.name, profile.avatarEmoji]);

  function handleDownload() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "japan-brag-card.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleShare() {
    if (!blob) return;
    const file = new File([blob], "japan-brag-card.png", { type: "image/png" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: t("map.brag.title") });
        return;
      } catch (err) {
        if ((err as DOMException | null)?.name === "AbortError") return; // user changed their mind
        // fall through — some browsers advertise share but fail on files
      }
    }
    handleDownload();
  }

  return (
    <div class="brag-backdrop" onClick={onClose}>
      <div class="panel brag-card" onClick={(e) => e.stopPropagation()}>
        <div class="brag-card__head">
          <h2 class="brag-card__title">{t("map.brag.make")}</h2>
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.sheet.cancel")}>
            <X size={20} />
          </button>
        </div>
        <canvas ref={canvasRef} class="brag-canvas" width={CARD_W} height={CARD_H} />
        {!prefs && <p class="brag-hint">{t("map.loading")}</p>}
        <div class="brag-actions">
          <button type="button" class="btn btn-primary" disabled={!blob} onClick={handleShare}>
            <Share2 size={18} />
            {t("map.brag.share")}
          </button>
          <button type="button" class="btn btn-tonal" disabled={!blob} onClick={handleDownload}>
            <Download size={18} />
            {t("map.brag.download")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useMemo } from "preact/hooks";
import { Download, Share2, X } from "lucide-preact";
import { getLanguage, useT, translate } from "../../lib/i18n";
import { useProfile } from "../../lib/personal";
import { buildJapanLayout, useJapanCollection, type Prefecture } from "./japanGeo";
import { badgeLabel, completionStats, earnedBadges } from "./collection";
import {
  CARD_W,
  CARD_H,
  token,
  drawCardFrame,
  drawCardHeader,
  drawStatsAndBar,
  drawPillRow,
  drawCardFooter,
  useBragCanvas,
  downloadBragImage,
  shareOrDownloadBragImage,
} from "./bragCardCanvas";
import "./map.i18n";
import "./map.css";

const TOP_BADGES = 3;

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

  drawCardFrame(ctx);
  drawCardHeader(ctx, font, translate("map.brag.title"), traveller);

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
  const barY = drawStatsAndBar(
    ctx,
    font,
    statsY,
    stats.count,
    stats.total,
    stats.exactPct,
    translate("map.jp.completion", { count: stats.count, total: stats.total, pct: stats.pct }),
  );

  // --- top badges ------------------------------------------------------------
  const top = earnedBadges(visited).slice(0, TOP_BADGES);
  const labels = top.map((id) => badgeLabel(id, translate));
  drawPillRow(ctx, font, barY + 78, labels);

  drawCardFooter(ctx, font);
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
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  const { canvasRef, blob } = useBragCanvas(
    (canvas) => drawBragCard(canvas, prefs as Prefecture[], visited, `${profile.avatarEmoji} ${profile.name}`),
    !!prefs,
    [prefs, visitedKey, lang, profile.name, profile.avatarEmoji],
  );

  function handleDownload() {
    if (!blob) return;
    downloadBragImage(blob, "japan-brag-card.png");
  }

  async function handleShare() {
    if (!blob) return;
    await shareOrDownloadBragImage(blob, "japan-brag-card.png", t("map.brag.title"));
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

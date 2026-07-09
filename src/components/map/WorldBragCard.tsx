import { useEffect, useMemo, useState } from "preact/hooks";
import { Download, Share2, X } from "lucide-preact";
import { getLanguage, useT, translate } from "../../lib/i18n";
import { useProfile } from "../../lib/personal";
import { loadWorld, loadWorldDetailed, type CountryFeature } from "../../lib/geo";
import { MAP_W, MAP_H, project, geometryToPath, geometryCentroid } from "./geoMath";
import { continentOf, CONTINENT_ORDER, type ContinentId } from "./continents";
import { useVisitedCountries } from "./worldCollection";
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

const TOP_CONTINENTS = 4;
const MAP_MAX_W = 880;
const MAP_MAX_H = 620;

/** Every continent with at least one visited country, most-explored first
 *  (ties broken by CONTINENT_ORDER) — the world card's answer to the Japan
 *  card's top badges. */
function topContinents(
  world: CountryFeature[],
  visited: ReadonlySet<string>,
): { id: ContinentId; visited: number; total: number }[] {
  const totals = new Map<ContinentId, number>();
  const seen = new Map<ContinentId, number>();
  for (const f of world) {
    const cont = continentOf(f.code, geometryCentroid(f.geometry));
    totals.set(cont, (totals.get(cont) ?? 0) + 1);
    if (visited.has(f.code)) seen.set(cont, (seen.get(cont) ?? 0) + 1);
  }
  return CONTINENT_ORDER.filter((c) => (seen.get(c) ?? 0) > 0)
    .map((c) => ({ id: c, visited: seen.get(c) ?? 0, total: totals.get(c) ?? 0 }))
    .sort((a, b) => b.visited - a.visited)
    .slice(0, TOP_CONTINENTS);
}

function drawWorldBragCard(
  canvas: HTMLCanvasElement,
  world: CountryFeature[],
  statsWorld: CountryFeature[],
  visited: ReadonlySet<string>,
  traveller: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";

  drawCardFrame(ctx);
  drawCardHeader(ctx, font, translate("map.brag.worldTitle"), traveller);

  // --- the map ---------------------------------------------------------------
  const scale = Math.min(MAP_MAX_W / MAP_W, MAP_MAX_H / MAP_H);
  const mapW = MAP_W * scale;
  const mapH = MAP_H * scale;
  ctx.save();
  ctx.translate((CARD_W - mapW) / 2, 240);
  ctx.scale(scale, scale);

  // Atlas graticule — faint meridians/parallels, the same "world atlas" flavor
  // as the on-screen map, so the card reads as world (not just any map).
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = token("--outline-variant");
  ctx.lineWidth = 1;
  for (let lng = -150; lng <= 150; lng += 30) {
    const x = project(lng, 0)[0];
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MAP_H);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = project(0, lat)[1];
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MAP_W, y);
    ctx.stroke();
  }
  ctx.restore();

  for (const f of world) {
    const d = geometryToPath(f.geometry);
    if (!d) continue;
    // evenodd matches pointInGeometry's ray-cast, so holes (enclaves) render as holes
    const path = new Path2D(d);
    if (visited.has(f.code)) {
      ctx.save();
      ctx.shadowColor = token("--gold");
      ctx.shadowBlur = 10;
      ctx.fillStyle = token("--primary-container");
      ctx.fill(path, "evenodd");
      ctx.restore();
      ctx.strokeStyle = token("--primary");
      ctx.lineWidth = 1.2;
      ctx.stroke(path);
    } else {
      ctx.fillStyle = token("--surface-container-low");
      ctx.fill(path, "evenodd");
      ctx.strokeStyle = token("--outline-variant");
      ctx.lineWidth = 0.6;
      ctx.stroke(path);
    }
  }
  ctx.restore();

  // --- stats ---------------------------------------------------------------
  const count = visited.size;
  const total = statsWorld.length;
  const exactPct = total > 0 ? (count / total) * 100 : 0;
  const statsY = 240 + mapH + 96;
  const barY = drawStatsAndBar(
    ctx,
    font,
    statsY,
    count,
    total,
    exactPct,
    translate("map.explored", { count, total, pct: Math.round(exactPct) }),
  );

  // --- top continents ----------------------------------------------------------
  const labels = topContinents(statsWorld, visited).map((c) => `${translate(`map.continent.${c.id}`)} ${c.visited}/${c.total}`);
  drawPillRow(ctx, font, barY + 78, labels);

  drawCardFooter(ctx, font);
}

interface WorldBragCardProps {
  onClose: () => void;
}

/** The world-atlas 自慢カード — same tone and share/download flow as the Japan
 *  BragCard, but for the fog-of-war world map: every visited country filled
 *  in on a portrait atlas, with the explored % and top continents beneath.
 *  Loads its own data (visited set + country geometry), so it can be mounted
 *  from either map renderer (the SVG WorldMap or the WebGL globe's MapScreen)
 *  without either needing to hand it anything. */
export function WorldBragCard({ onClose }: WorldBragCardProps) {
  const t = useT();
  const lang = getLanguage();
  const [profile] = useProfile();
  const visited = useVisitedCountries();
  const [world, setWorld] = useState<CountryFeature[] | null>(null);
  const [statsWorld, setStatsWorld] = useState<CountryFeature[] | null>(null);
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  useEffect(() => {
    let cancelled = false;
    // Detailed (50m) coastlines for the drawing, plain (110m) for the
    // denominator — same split WorldMap.tsx renders with, and both promises
    // are already cached module-side, so this costs nothing extra once the
    // world tab has loaded once.
    loadWorldDetailed().then((w) => {
      if (!cancelled) setWorld(w.features);
    });
    loadWorld().then((w) => {
      if (!cancelled) setStatsWorld(w.features);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !!world && !!statsWorld;
  const { canvasRef, blob } = useBragCanvas(
    (canvas) => drawWorldBragCard(canvas, world as CountryFeature[], statsWorld as CountryFeature[], visited, `${profile.avatarEmoji} ${profile.name}`),
    ready,
    [world, statsWorld, visitedKey, lang, profile.name, profile.avatarEmoji],
  );

  function handleDownload() {
    if (!blob) return;
    downloadBragImage(blob, "world-brag-card.png");
  }

  async function handleShare() {
    if (!blob) return;
    await shareOrDownloadBragImage(blob, "world-brag-card.png", t("map.brag.worldTitle"));
  }

  return (
    <div class="brag-backdrop" onClick={onClose}>
      <div class="panel brag-card" onClick={(e) => e.stopPropagation()}>
        <div class="brag-card__head">
          <h2 class="brag-card__title">{t("map.brag.makeWorld")}</h2>
          <button type="button" class="btn btn-icon" onClick={onClose} aria-label={t("map.sheet.cancel")}>
            <X size={20} />
          </button>
        </div>
        <canvas ref={canvasRef} class="brag-canvas" width={CARD_W} height={CARD_H} />
        {!ready && <p class="brag-hint">{t("map.loading")}</p>}
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

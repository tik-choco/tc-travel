import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronRight, Compass, MapPin, Search, Sparkles } from "lucide-preact";
import { getLanguage, useT } from "../../lib/i18n";
import type { EncounterPin } from "../../lib/types";
import { useMembers, usePins, removePin } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useUnifiedJourney, addPinAuto } from "../../lib/memories";
import { useLocalPins, removeLocalPin } from "../../lib/local/localMemories";
import { loadWorld, loadWorldDetailed, lookupCountry, countryName } from "../../lib/geo";
import type { CountryFeature } from "../../lib/geo";
import { MAP_W, MAP_H, project, unproject, geometryToPath, geometryCentroid, clamp } from "./geoMath";
import type { SimpleGeometry } from "./geoMath";
import { continentOf, CONTINENT_ORDER, type ContinentId } from "./continents";
import { EncounterSheet, type SheetTarget } from "./EncounterSheet";
import { LocationPicker, type PickedLocation } from "./LocationPicker";
import { useJapanCollection } from "./japanGeo";
import { JapanMap } from "./JapanMap";
import { BragCard } from "./BragCard";
import { WorldBragCard } from "./WorldBragCard";
import "./map.i18n";
import "./map.css";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const TAP_MAX_MOVE = 6;
const TAP_MAX_DURATION = 600;
const REVEAL_ANIM_MS = 1400;

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

/** Projected anchor point for the reveal flourish. A vertex mean of the
 * largest outer ring, NOT geometryCentroid's bbox center: bbox centers land in
 * the open ocean for antimeridian-crossing countries (US, RU, FJ) and
 * multi-territory ones (FR), and the burst is a visible reward — it has to
 * appear on the landmass the traveller just unlocked. */
function revealAnchor(geometry: SimpleGeometry): [number, number] | null {
  let ring: number[][] | null = null;
  if (geometry.type === "Polygon") {
    ring = (geometry.coordinates as number[][][])[0] ?? null;
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates as number[][][][]) {
      if (poly[0] && (!ring || poly[0].length > ring.length)) ring = poly[0];
    }
  }
  if (!ring || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of ring) {
    const [x, y] = project(lng, lat);
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/** The fog-of-war world map — the app's core retention loop. */
export function WorldMap() {
  const t = useT();
  const lang = getLanguage();
  const [profile] = useProfile();
  const members = useMembers();
  const roomPins = usePins();
  const localPins = useLocalPins();
  // Unified journey folds solo memories into pins/photos/diary, so fog reveal,
  // explored %, continent counts and the Japan drill-down all light up for solo
  // captures exactly as they do for room ones.
  const journey = useUnifiedJourney();

  const [world, setWorld] = useState<CountryFeature[] | null>(null);
  // Stats (explored %, per-continent counts) stay on the 110m atlas: that's
  // the dataset lookupCountry() marks visits against, so it's the only
  // denominator every territory of which is actually reachable. The detailed
  // 50m set is for RENDERING only — it carries ~60 extra small territories
  // a visit can never resolve to, which would silently deflate the counts.
  const [statsWorld, setStatsWorld] = useState<CountryFeature[] | null>(null);
  const [worldError, setWorldError] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [jpOpen, setJpOpen] = useState(false);
  const [bragOpen, setBragOpen] = useState(false);
  const [worldBragOpen, setWorldBragOpen] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ lastX: number; lastY: number; startX: number; startY: number; moved: boolean; startTime: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWorldDetailed()
      .then((w) => {
        if (!cancelled) setWorld(w.features);
      })
      .catch(() => {
        if (!cancelled) setWorldError(true);
      });
    loadWorld()
      .then((w) => {
        if (!cancelled) setStatsWorld(w.features);
      })
      .catch(() => {
        if (!cancelled) setWorldError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visited = useMemo(() => {
    const s = new Set<string>();
    for (const p of journey.pins) if (p.countryCode) s.add(p.countryCode);
    for (const p of journey.photos) if (p.geo?.countryCode) s.add(p.geo.countryCode);
    for (const d of journey.diary) if (d.geo?.countryCode) s.add(d.geo.countryCode);
    return s;
  }, [journey.pins, journey.photos, journey.diary]);

  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  // Japan drill-down: the prefecture geojson is only fetched once the
  // traveller actually has a Japan visit — until then this hook is inert.
  const japanUnlocked = visited.has("jp");
  const japan = useJapanCollection(japanUnlocked);

  // Fog-reveal animation: track which countries newly entered `visited` since
  // the last render and flag them for a short one-shot animation.
  // `bursting` additionally drives a golden centroid flourish, but skips the
  // first run: the component remounts on every tab switch, so the initial run
  // re-flags every visited country — replaying the fill shimmer map-wide is a
  // nice "atlas wakes up" moment, but a simultaneous star-burst over every
  // country would drown the real reward of unlocking a NEW one.
  const prevVisitedRef = useRef<Set<string>>(new Set());
  const firstRevealRef = useRef(true);
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  const [bursting, setBursting] = useState<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevVisitedRef.current;
    const fresh = [...visited].filter((c) => !prev.has(c));
    prevVisitedRef.current = new Set(visited);
    const isFirst = firstRevealRef.current;
    firstRevealRef.current = false;
    if (fresh.length === 0) return;
    setRevealing((r) => new Set([...r, ...fresh]));
    if (!isFirst) setBursting((b) => new Set([...b, ...fresh]));
    const timer = setTimeout(() => {
      setRevealing((r) => {
        const next = new Set(r);
        for (const c of fresh) next.delete(c);
        return next;
      });
      setBursting((b) => {
        const next = new Set(b);
        for (const c of fresh) next.delete(c);
        return next;
      });
    }, REVEAL_ANIM_MS);
    return () => clearTimeout(timer);
  }, [visitedKey]);

  const exactPct = statsWorld && statsWorld.length > 0 ? (visited.size / statsWorld.length) * 100 : 0;
  const pct = Math.round(exactPct);
  // Bar width uses the unrounded value so the very first country moves the
  // needle (1/177 rounds to 0%) — a sliver of gold beats an empty track.
  const barPct = visited.size > 0 ? Math.max(exactPct, 1.5) : 0;

  // Dopamine on progress: pulse the stat card whenever explored % rises, with
  // a stronger gold flourish when it crosses into a new tens bracket. Primed
  // on the first computed value so mounting doesn't celebrate by itself.
  const prevPctRef = useRef<number | null>(null);
  const [celebrate, setCelebrate] = useState<"" | "pulse" | "milestone">("");
  useEffect(() => {
    if (!statsWorld) return;
    const prev = prevPctRef.current;
    prevPctRef.current = pct;
    if (prev === null || pct <= prev) return;
    setCelebrate(Math.floor(pct / 10) > Math.floor(prev / 10) ? "milestone" : "pulse");
    const timer = setTimeout(() => setCelebrate(""), 1300);
    return () => clearTimeout(timer);
  }, [pct, statsWorld]);

  const continentStats = useMemo(() => {
    if (!statsWorld) return [] as { id: ContinentId; visited: number; total: number }[];
    const totals = new Map<ContinentId, number>();
    const seen = new Map<ContinentId, number>();
    for (const f of statsWorld) {
      const cont = continentOf(f.code, geometryCentroid(f.geometry));
      totals.set(cont, (totals.get(cont) ?? 0) + 1);
      if (visited.has(f.code)) seen.set(cont, (seen.get(cont) ?? 0) + 1);
    }
    return CONTINENT_ORDER.filter((c) => totals.has(c)).map((c) => ({
      id: c,
      visited: seen.get(c) ?? 0,
      total: totals.get(c) ?? 0,
    }));
  }, [statsWorld, visitedKey]);

  // journey.pins already includes local pins (unified), but union the live
  // room + local arrays too: those are the current mutable sources, so a pin
  // just added/removed shows or clears immediately, before the journey mirror
  // settles. De-duped by id, so the overlap is harmless.
  const allPins = useMemo(() => {
    const map = new Map<string, EncounterPin>();
    for (const p of journey.pins) map.set(p.id, p);
    for (const p of localPins) map.set(p.id, p);
    for (const p of roomPins) map.set(p.id, p);
    return [...map.values()];
  }, [journey.pins, localPins, roomPins]);

  // Path strings only depend on the (immutable-once-loaded) world geometry,
  // not on fog/reveal state, so compute them once instead of on every render.
  // key must combine code and name: the atlas maps some disputed territories
  // onto their claimant's code (Somaliland→so, N. Cyprus→cy) and leaves a
  // couple with no code at all, so neither field alone is unique.
  const countryPaths = useMemo(
    () => world?.map((f) => ({ key: `${f.code}:${f.name}`, code: f.code, d: geometryToPath(f.geometry) })) ?? [],
    [world],
  );

  // Atlas graticule: the projection is linear, so meridians/parallels are
  // straight lines — a dozen static <line>s, computed once.
  const graticule = useMemo(() => {
    const meridians: number[] = [];
    for (let lng = -150; lng <= 150; lng += 30) meridians.push(project(lng, 0)[0]);
    const parallels: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30) parallels.push(project(0, lat)[1]);
    return { meridians, parallels };
  }, []);

  // Reward flourish anchors for freshly-unlocked countries. Empty in steady
  // state, so this does no work on ordinary re-renders or during pan/zoom.
  const revealBursts = useMemo(() => {
    if (!world || bursting.size === 0) return [] as { code: string; x: number; y: number }[];
    const bursts: { code: string; x: number; y: number }[] = [];
    for (const code of bursting) {
      const f = world.find((w) => w.code === code);
      if (!f) continue;
      const anchor = revealAnchor(f.geometry);
      if (anchor) bursts.push({ code, x: anchor[0], y: anchor[1] });
    }
    return bursts;
  }, [world, bursting]);

  function applyViewBox() {
    const v = viewRef.current;
    svgRef.current?.setAttribute("viewBox", `${v.x} ${v.y} ${MAP_W / v.scale} ${MAP_H / v.scale}`);
  }

  function clampView() {
    const v = viewRef.current;
    const w = MAP_W / v.scale;
    const h = MAP_H / v.scale;
    const slackX = w * 0.4;
    const slackY = h * 0.4;
    v.x = clamp(v.x, -slackX, MAP_W - w + slackX);
    v.y = clamp(v.y, -slackY, MAP_H - h + slackY);
  }

  function screenToSvg(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const v = viewRef.current;
    const w = MAP_W / v.scale;
    const h = MAP_H / v.scale;
    return {
      x: v.x + ((clientX - rect.left) / rect.width) * w,
      y: v.y + ((clientY - rect.top) / rect.height) * h,
    };
  }

  function zoomAt(clientX: number, clientY: number, newScale: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const v = viewRef.current;
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const oldW = MAP_W / v.scale;
    const oldH = MAP_H / v.scale;
    const anchorX = v.x + fx * oldW;
    const anchorY = v.y + fy * oldH;
    const scale = clamp(newScale, MIN_SCALE, MAX_SCALE);
    const newW = MAP_W / scale;
    const newH = MAP_H / scale;
    v.scale = scale;
    v.x = anchorX - fx * newW;
    v.y = anchorY - fy * newH;
    clampView();
    applyViewBox();
  }

  function openEncounterSheetAt(lat: number, lng: number) {
    setSheet({ mode: "new", lat, lng, countryCode: "", resolving: true });
    void lookupCountry(lat, lng).then((code) => {
      setSheet((s) => (s && s.mode === "new" && s.lat === lat && s.lng === lng ? { ...s, countryCode: code, resolving: false } : s));
    });
  }

  /** LocationPicker result: the search index already resolved lat/lng/country
   *  for this entry, so the sheet opens straight away — no "locating…" phase,
   *  same reward as a tap that landed cleanly on the first try. Works both as
   *  a fresh open (FAB) and as a correction of an already-open sheet (ocean
   *  escape hatch) — EncounterSheet stays mounted either way, so any title/
   *  note the traveller already typed survives the location swap. */
  function handlePickLocation(loc: PickedLocation) {
    setPickerOpen(false);
    setSheet({ mode: "new", lat: loc.lat, lng: loc.lng, countryCode: loc.countryCode, resolving: false, pickerLabel: loc.label });
  }

  function handleTap(clientX: number, clientY: number) {
    const pt = screenToSvg(clientX, clientY);
    const { lat, lng } = unproject(clamp(pt.x, 0, MAP_W), clamp(pt.y, 0, MAP_H));
    openEncounterSheetAt(lat, lng);
  }

  /** FAB / empty-state CTA: record an encounter at the current viewport center,
   * so the action works without requiring a precise tap on the map first. */
  function handleAddAtCenter() {
    const v = viewRef.current;
    const w = MAP_W / v.scale;
    const h = MAP_H / v.scale;
    const { lat, lng } = unproject(clamp(v.x + w / 2, 0, MAP_W), clamp(v.y + h / 2, 0, MAP_H));
    openEncounterSheetAt(lat, lng);
  }

  function handlePointerDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragRef.current = { lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, startTime: performance.now() };
      pinchRef.current = null;
    } else if (pointers.current.size === 2) {
      dragRef.current = null;
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      pinchRef.current = { startDist: dist, startScale: viewRef.current.scale };
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinchRef.current) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      zoomAt(midX, midY, pinchRef.current.startScale * (dist / pinchRef.current.startDist));
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const v = viewRef.current;
    const w = MAP_W / v.scale;
    const h = MAP_H / v.scale;
    v.x -= ((e.clientX - drag.lastX) / rect.width) * w;
    v.y -= ((e.clientY - drag.lastY) / rect.height) * h;
    clampView();
    applyViewBox();
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > TAP_MAX_MOVE) drag.moved = true;
  }

  function handlePointerUp(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0 && dragRef.current) {
      const drag = dragRef.current;
      dragRef.current = null;
      const duration = performance.now() - drag.startTime;
      if (!drag.moved && duration < TAP_MAX_DURATION) handleTap(e.clientX, e.clientY);
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, viewRef.current.scale * factor);
  }

  function handleDblClick(e: MouseEvent) {
    zoomAt(e.clientX, e.clientY, viewRef.current.scale * 2);
  }

  function labelFor(code: string, resolving?: boolean): string {
    if (resolving) return t("map.sheet.locating");
    if (!code) return t("map.sheet.ocean");
    return countryName(code, lang);
  }

  return (
    <div class="screen map-screen">
      <div class="map-viewport">
        {!world && !worldError && <p class="map-loading">{t("map.loading")}</p>}
        {worldError && <p class="map-error">{t("map.error")}</p>}
        {world && (
          <svg
            ref={svgRef}
            class="map-svg"
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            aria-label={t("map.title")}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            onDblClick={handleDblClick}
          >
            <defs>
              {/* Ocean: soft light at the center, deepening toward the map
                  edges — stop colors live in map.css so they follow the theme. */}
              <radialGradient id="map-ocean-grad" cx="50%" cy="38%" r="85%">
                <stop offset="0%" class="map-ocean-stop--core" />
                <stop offset="55%" class="map-ocean-stop--mid" />
                <stop offset="100%" class="map-ocean-stop--edge" />
              </radialGradient>
              {/* Visited land: one shared world-spanning gradient (userSpaceOnUse)
                  gives explored terrain a warm north-to-south drift without
                  per-path filters — every visited path just references it. */}
              <linearGradient id="map-land-grad" x1={0} y1={0} x2={0} y2={MAP_H} gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="map-land-stop--north" />
                <stop offset="55%" class="map-land-stop--mid" />
                <stop offset="100%" class="map-land-stop--south" />
              </linearGradient>
            </defs>
            <rect class="map-ocean" x={0} y={0} width={MAP_W} height={MAP_H} />
            <g class="map-graticule" aria-hidden="true">
              {graticule.meridians.map((x) => (
                <line key={`m${x}`} x1={x} y1={0} x2={x} y2={MAP_H} />
              ))}
              {graticule.parallels.map((y) => (
                <line key={`p${y}`} x1={0} y1={y} x2={MAP_W} y2={y} />
              ))}
            </g>
            {countryPaths.map(({ key, code, d }) => (
              <path
                key={key}
                class={[
                  "map-country",
                  visited.has(code) ? "map-country--visited" : "map-country--fog",
                  revealing.has(code) ? "map-country--revealing" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                d={d}
              />
            ))}
            {revealBursts.map((b) => (
              <g key={b.code} class="map-reveal-burst" aria-hidden="true" transform={`translate(${b.x}, ${b.y})`}>
                <circle class="map-reveal-burst__ripple" r={6} />
                <circle class="map-reveal-burst__ripple map-reveal-burst__ripple--late" r={6} />
                <path class="map-reveal-burst__star" d="M0,-14 L3,-3 L14,0 L3,3 L0,14 L-3,3 L-14,0 L-3,-3 Z" />
              </g>
            ))}
            {allPins.map((pin) => {
              const [x, y] = project(pin.lng, pin.lat);
              const member = members.find((m) => m.id === pin.by);
              return (
                <g
                  key={pin.id}
                  class="map-pin"
                  transform={`translate(${x}, ${y})`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSheet({ mode: "view", pin })}
                >
                  <circle class="map-pin__ring" r={7} stroke={member?.color ?? "var(--primary)"} />
                  <circle class="map-pin__seal" r={4.5} />
                </g>
              );
            })}
          </svg>
        )}

        {world && (
          <div class={["panel", "panel-tight", "map-stat-card", celebrate ? `map-stat-card--${celebrate}` : ""].filter(Boolean).join(" ")}>
            <h1 class="map-stat-card__title">{t("map.title")}</h1>
            <p class="map-stat-card__main">{t("map.explored", { count: visited.size, total: world.length, pct })}</p>
            {/* Decorative: the stat line above already carries the numbers. */}
            <div class="map-progress" aria-hidden="true">
              <div class="map-progress__fill" style={{ width: `${barPct}%` }} />
            </div>
            <div class="map-continents">
              {continentStats.map((c) => (
                <span class="map-continent-chip" key={c.id}>
                  {t(`map.continent.${c.id}`)} {c.visited}/{c.total}
                </span>
              ))}
            </div>
            {(japanUnlocked || visited.size > 0) && (
              <div class="map-japan-row">
                {japanUnlocked && (
                  <button type="button" class="map-continent-chip map-japan-chip" onClick={() => setJpOpen(true)}>
                    🇯🇵 {t("map.jp.open")}
                    {japan.prefs ? ` ${japan.visited.size}/${japan.prefs.length}` : ""}
                    <ChevronRight size={12} />
                  </button>
                )}
                {japanUnlocked && japan.visited.size > 0 && (
                  <button type="button" class="map-continent-chip map-japan-chip" onClick={() => setBragOpen(true)}>
                    <Sparkles size={12} /> {t("map.brag.make")}
                  </button>
                )}
                {/* World brag card: available as soon as any country is visited,
                    regardless of the Japan drill-down being unlocked. */}
                {visited.size > 0 && (
                  <button type="button" class="map-continent-chip map-japan-chip" onClick={() => setWorldBragOpen(true)}>
                    <Sparkles size={12} /> {t("map.brag.makeWorld")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {world && (
          <div class="map-compass" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="46" height="46">
              <circle class="map-compass__bg" cx={24} cy={24} r={22} />
              <circle class="map-compass__ring" cx={24} cy={24} r={19} />
              <circle class="map-compass__ring map-compass__ring--inner" cx={24} cy={24} r={14.5} />
              <path
                class="map-compass__star map-compass__star--minor"
                d="M24,10 L26,22 L38,24 L26,26 L24,38 L22,26 L10,24 L22,22 Z"
                transform="rotate(45 24 24)"
              />
              <path class="map-compass__star" d="M24,5 L27,21 L43,24 L27,27 L24,43 L21,27 L5,24 L21,21 Z" />
              <path class="map-compass__north" d="M24,5 L26.5,21.5 L24,19.5 L21.5,21.5 Z" />
            </svg>
          </div>
        )}

        {world && allPins.length === 0 && (
          <div class="map-empty-overlay">
            <div class="empty-state panel map-empty-card">
              <div class="empty-state-icon">
                <Compass size={28} />
              </div>
              <p class="empty-state-title">{t("map.empty.title")}</p>
              <p class="empty-state-hint">{t("map.empty.hint")}</p>
              <button type="button" class="btn btn-primary" onClick={handleAddAtCenter}>
                {t("map.fab.add")}
              </button>
            </div>
          </div>
        )}

        {jpOpen && (
          <JapanMap
            onClose={() => setJpOpen(false)}
            onBrag={() => setBragOpen(true)}
            onRecordAt={(lat, lng, label) => {
              setJpOpen(false);
              handlePickLocation({ lat, lng, label, countryCode: "jp" });
            }}
          />
        )}
      </div>

      {/* FABs hide while the Japan overlay is open — they target the world map. */}
      {world && !worldError && !jpOpen && (
        <button type="button" class="fab" onClick={handleAddAtCenter}>
          <MapPin size={22} />
          <span class="fab-label">{t("map.fab.add")}</span>
        </button>
      )}
      {world && !worldError && !jpOpen && (
        <button
          type="button"
          class="map-search-fab"
          onClick={() => setPickerOpen(true)}
          aria-label={t("map.picker.searchAria")}
        >
          <Search size={20} />
        </button>
      )}

      {bragOpen && <BragCard onClose={() => setBragOpen(false)} />}
      {worldBragOpen && <WorldBragCard onClose={() => setWorldBragOpen(false)} />}

      {sheet && (
        <EncounterSheet
          target={sheet}
          locationLabel={
            sheet.mode === "view"
              ? labelFor(sheet.pin.countryCode)
              : (sheet.pickerLabel ?? labelFor(sheet.countryCode, sheet.resolving))
          }
          canSave={sheet.mode === "new"}
          canDelete={
            sheet.mode === "view" &&
            sheet.pin.by === profile.id &&
            (roomPins.some((p) => p.id === sheet.pin.id) || localPins.some((p) => p.id === sheet.pin.id))
          }
          onClose={() => setSheet(null)}
          onPickLocation={() => setPickerOpen(true)}
          onSave={(data) => {
            if (sheet.mode !== "new") return;
            // Routes to the room Y.Doc in a party, else the local solo store.
            addPinAuto({ lat: sheet.lat, lng: sheet.lng, countryCode: sheet.countryCode, ...data });
            setSheet(null);
          }}
          onDelete={() => {
            if (sheet.mode !== "view") return;
            // A pin lives in exactly one home; delete it from the right one.
            if (localPins.some((p) => p.id === sheet.pin.id)) removeLocalPin(sheet.pin.id);
            else removePin(sheet.pin.id);
            setSheet(null);
          }}
        />
      )}

      {pickerOpen && <LocationPicker onSelect={handlePickLocation} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

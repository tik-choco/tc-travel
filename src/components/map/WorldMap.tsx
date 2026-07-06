import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Compass, MapPin } from "lucide-preact";
import { getLanguage, useT } from "../../lib/i18n";
import type { EncounterPin } from "../../lib/types";
import { useSession, useMembers, usePins, addPin, removePin } from "../../lib/store";
import { useProfile, useJourney } from "../../lib/personal";
import { loadWorld, lookupCountry, countryName } from "../../lib/geo";
import type { CountryFeature } from "../../lib/geo";
import { MAP_W, MAP_H, project, unproject, geometryToPath, geometryCentroid, clamp } from "./geoMath";
import { continentOf, CONTINENT_ORDER, type ContinentId } from "./continents";
import { EncounterSheet, type SheetTarget } from "./EncounterSheet";
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

/** The fog-of-war world map — the app's core retention loop. */
export function WorldMap() {
  const t = useT();
  const lang = getLanguage();
  const session = useSession();
  const [profile] = useProfile();
  const members = useMembers();
  const roomPins = usePins();
  const journey = useJourney();

  const [world, setWorld] = useState<CountryFeature[] | null>(null);
  const [worldError, setWorldError] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ lastX: number; lastY: number; startX: number; startY: number; moved: boolean; startTime: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWorld()
      .then((w) => {
        if (!cancelled) setWorld(w.features);
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

  // Fog-reveal animation: track which countries newly entered `visited` since
  // the last render and flag them for a short one-shot animation.
  const prevVisitedRef = useRef<Set<string>>(new Set());
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevVisitedRef.current;
    const fresh = [...visited].filter((c) => !prev.has(c));
    prevVisitedRef.current = new Set(visited);
    if (fresh.length === 0) return;
    setRevealing((r) => new Set([...r, ...fresh]));
    const timer = setTimeout(() => {
      setRevealing((r) => {
        const next = new Set(r);
        for (const c of fresh) next.delete(c);
        return next;
      });
    }, REVEAL_ANIM_MS);
    return () => clearTimeout(timer);
  }, [visitedKey]);

  const pct = world && world.length > 0 ? Math.round((visited.size / world.length) * 100) : 0;

  const continentStats = useMemo(() => {
    if (!world) return [] as { id: ContinentId; visited: number; total: number }[];
    const totals = new Map<ContinentId, number>();
    const seen = new Map<ContinentId, number>();
    for (const f of world) {
      const cont = continentOf(f.code, geometryCentroid(f.geometry));
      totals.set(cont, (totals.get(cont) ?? 0) + 1);
      if (visited.has(f.code)) seen.set(cont, (seen.get(cont) ?? 0) + 1);
    }
    return CONTINENT_ORDER.filter((c) => totals.has(c)).map((c) => ({
      id: c,
      visited: seen.get(c) ?? 0,
      total: totals.get(c) ?? 0,
    }));
  }, [world, visitedKey]);

  const allPins = useMemo(() => {
    const map = new Map<string, EncounterPin>();
    for (const p of journey.pins) map.set(p.id, p);
    for (const p of roomPins) map.set(p.id, p);
    return [...map.values()];
  }, [journey.pins, roomPins]);

  // Path strings only depend on the (immutable-once-loaded) world geometry,
  // not on fog/reveal state, so compute them once instead of on every render.
  const countryPaths = useMemo(() => world?.map((f) => ({ code: f.code, d: geometryToPath(f.geometry) })) ?? [], [world]);

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
            <rect class="map-ocean" x={0} y={0} width={MAP_W} height={MAP_H} />
            {countryPaths.map(({ code, d }) => (
              <path
                key={code}
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
          <div class="panel panel-tight map-stat-card">
            <h1 class="map-stat-card__title">{t("map.title")}</h1>
            <p class="map-stat-card__main">{t("map.explored", { count: visited.size, total: world.length, pct })}</p>
            <div class="map-continents">
              {continentStats.map((c) => (
                <span class="map-continent-chip" key={c.id}>
                  {t(`map.continent.${c.id}`)} {c.visited}/{c.total}
                </span>
              ))}
            </div>
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
      </div>

      {world && !worldError && (
        <button type="button" class="fab" onClick={handleAddAtCenter}>
          <MapPin size={22} />
          <span class="fab-label">{t("map.fab.add")}</span>
        </button>
      )}

      {sheet && (
        <EncounterSheet
          target={sheet}
          locationLabel={sheet.mode === "view" ? labelFor(sheet.pin.countryCode) : labelFor(sheet.countryCode, sheet.resolving)}
          canSave={sheet.mode === "new" && session !== null}
          canDelete={sheet.mode === "view" && sheet.pin.by === profile.id && roomPins.some((p) => p.id === sheet.pin.id)}
          onClose={() => setSheet(null)}
          onSave={(data) => {
            if (sheet.mode !== "new") return;
            addPin({ lat: sheet.lat, lng: sheet.lng, countryCode: sheet.countryCode, ...data });
            setSheet(null);
          }}
          onDelete={() => {
            if (sheet.mode !== "view") return;
            removePin(sheet.pin.id);
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

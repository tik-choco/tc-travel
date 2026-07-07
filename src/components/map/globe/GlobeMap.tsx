// The 3D globe world map — WorldMap's successor. This component owns the
// DATA side (hooks, EncounterSheet, stat card, FAB, reveal bookkeeping) and
// feeds the imperative GlobeScene through setters; the scene owns everything
// per-frame. Reward feeling is preserved 1:1 from WorldMap: fog lifts with a
// gold flash + burst on a NEW country only, the stat card pulses when the
// explored % rises, and milestones get the stronger flourish.
//
// Photos and sub-national drill-downs are OTHER modules' screens: taps on
// them are forwarded through onOpenPhoto/onOpenCountry so this file never
// imports the viewer or the drill-down (they're built concurrently).

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Compass, MapPin } from "lucide-preact";
import { getLanguage, useT } from "../../../lib/i18n";
import type { AlbumPhoto, EncounterPin } from "../../../lib/types";
import { useMembers, usePins, removePin } from "../../../lib/store";
import { useProfile } from "../../../lib/personal";
import { addPinAuto, resolveAlbumPhotoUrl, useAlbumPhotos, useUnifiedJourney } from "../../../lib/memories";
import { useLocalPins, removeLocalPin } from "../../../lib/local/localMemories";
import { loadWorld, loadWorldDetailed, lookupCountry, countryName } from "../../../lib/geo";
import type { CountryFeature } from "../../../lib/geo";
import {
  resolveMunicipality,
  resolvedForPoint,
  type ResolvedMunicipality,
} from "../../../lib/geo/municipalResolver";
import { useExplorationStats } from "../../../lib/explorationStats";
import { geometryCentroid } from "../geoMath";
import { continentOf, CONTINENT_ORDER, type ContinentId } from "../continents";
import { EncounterSheet, type SheetTarget } from "../EncounterSheet";
import { GlobeScene, type GlobeTapHit } from "./globeScene";
import "../map.i18n";
import "./globe.i18n";
import "../map.css";
import "./globe.css";

export interface GlobeMapProps {
  /** Tap on a single photo billboard — the orchestrator opens its viewer. */
  onOpenPhoto?: (photo: AlbumPhoto) => void;
  /** Tap on a visited country that has a drill-down — orchestrator opens it. */
  onOpenCountry?: (countryCode: string) => void;
  /** Visited countries onOpenCountry can handle. Defaults to Japan only. */
  drillDownCodes?: string[];
}

const REVEAL_ANIM_MS = 1400;
const DEFAULT_DRILLDOWN = ["jp"];

/** The fog-of-war world, now a globe — the app's core retention loop. */
export function GlobeMap({ onOpenPhoto, onOpenCountry, drillDownCodes }: GlobeMapProps) {
  const t = useT();
  const lang = getLanguage();
  const [profile] = useProfile();
  const members = useMembers();
  const roomPins = usePins();
  const localPins = useLocalPins();
  const journey = useUnifiedJourney();
  const albumPhotos = useAlbumPhotos();

  // Stats stay on the 110m atlas — the dataset lookupCountry() marks visits
  // against — while the 50m set feeds RENDERING only (same split, and same
  // reasoning, as WorldMap: the detailed set carries territories a visit can
  // never resolve to, which would deflate the explored %).
  const [statsWorld, setStatsWorld] = useState<CountryFeature[] | null>(null);
  const [renderWorld, setRenderWorld] = useState<CountryFeature[] | null>(null);
  const [worldError, setWorldError] = useState(false);
  const [glError, setGlError] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  // The open sheet's municipality, resolved at pin time (never blocks saving:
  // the label just upgrades from "Japan" to "Shinjuku · Japan" when it lands).
  const [sheetMuni, setSheetMuni] = useState<ResolvedMunicipality | null>(null);
  const muniSeqRef = useRef(0);

  /** Kick municipality resolution for a sheet's point. Sync-answers from the
   *  warm index immediately; the async path fills in (or stays null for
   *  ocean / no-ADM2 countries / offline — the sheet shows the country alone). */
  function beginSheetMuniResolve(lat: number, lng: number): void {
    const seq = ++muniSeqRef.current;
    setSheetMuni(resolvedForPoint(lat, lng));
    void resolveMunicipality(lat, lng).then((m) => {
      if (muniSeqRef.current === seq && m) setSheetMuni(m);
    });
  }

  function closeSheet(): void {
    muniSeqRef.current++; // invalidate any in-flight municipality resolution
    setSheetMuni(null);
    setSheet(null);
  }

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWorldDetailed()
      .then((w) => {
        if (!cancelled) setRenderWorld(w.features);
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

  // --- scene lifecycle ---------------------------------------------------------

  // Taps route through a ref so the (created-once) scene always sees the
  // current visited set / pins / callbacks — same latest-callback idiom as
  // HomeVrmStage's onErrorRef.
  const onTapRef = useRef<(hit: GlobeTapHit) => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: GlobeScene;
    try {
      scene = new GlobeScene(host, { onTap: (hit) => onTapRef.current(hit) });
    } catch (err) {
      console.error("tc-travel: globe scene failed to start", err);
      setGlError(true);
      return;
    }
    sceneRef.current = scene;
    setSceneReady(true);
    return () => {
      sceneRef.current = null;
      setSceneReady(false);
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    if (renderWorld && sceneReady) sceneRef.current?.setWorld(renderWorld);
  }, [renderWorld, sceneReady]);

  // --- visited fog + reveal ------------------------------------------------------

  const visited = useMemo(() => {
    const s = new Set<string>();
    for (const p of journey.pins) if (p.countryCode) s.add(p.countryCode);
    for (const p of journey.photos) if (p.geo?.countryCode) s.add(p.geo.countryCode);
    for (const d of journey.diary) if (d.geo?.countryCode) s.add(d.geo.countryCode);
    return s;
  }, [journey.pins, journey.photos, journey.diary]);
  const visitedKey = useMemo(() => [...visited].sort().join(","), [visited]);

  // First push after mount replays NO celebration (the tab remounts this
  // component, and every visited country would re-flag) — WorldMap's
  // firstReveal logic, verbatim in spirit.
  const prevVisitedRef = useRef<Set<string>>(new Set());
  const firstRevealRef = useRef(true);
  useEffect(() => {
    if (!sceneReady) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const prev = prevVisitedRef.current;
    const fresh = [...visited].filter((c) => !prev.has(c));
    prevVisitedRef.current = new Set(visited);
    const isFirst = firstRevealRef.current;
    firstRevealRef.current = false;
    scene.setVisited(visited, isFirst ? [] : fresh);
  }, [visitedKey, sceneReady, renderWorld]);

  // --- pins ------------------------------------------------------------------------

  const allPins = useMemo(() => {
    const map = new Map<string, EncounterPin>();
    for (const p of journey.pins) map.set(p.id, p);
    for (const p of roomPins) map.set(p.id, p);
    return [...map.values()];
  }, [journey.pins, roomPins]);

  const pinInputs = useMemo(
    () =>
      allPins.map((pin) => ({
        id: pin.id,
        lat: pin.lat,
        lng: pin.lng,
        // Member color when known; own solo pins wear the profile color. The
        // fallback must be a concrete color (three can't resolve a var()).
        color: members.find((m) => m.id === pin.by)?.color ?? (pin.by === profile.id ? profile.color : "#c9a24b"),
      })),
    [allPins, members, profile.id, profile.color],
  );
  const pinsKey = useMemo(() => pinInputs.map((p) => `${p.id}:${p.color}`).join(","), [pinInputs]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setPins(pinInputs);
    // pinsKey covers pinInputs' identity-relevant content.
  }, [pinsKey, sceneReady]);

  // First framing: open on the traveller's most recent memory, not a fixed
  // hemisphere — their globe should greet them with THEIR world.
  const centeredRef = useRef(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || centeredRef.current || allPins.length === 0) return;
    centeredRef.current = true;
    if (scene.hasUserInteracted()) return;
    const newest = allPins.reduce((a, b) => (b.at > a.at ? b : a));
    scene.lookAtLatLng(newest.lat, newest.lng);
  }, [pinsKey, sceneReady]);

  // --- photo billboards ---------------------------------------------------------

  const geoPhotos = useMemo(() => albumPhotos.filter((p) => p.geo !== null), [albumPhotos]);
  const photosKey = useMemo(() => geoPhotos.map((p) => p.id).join(","), [geoPhotos]);
  useEffect(() => {
    if (sceneReady) sceneRef.current?.setPhotos(geoPhotos, resolveAlbumPhotoUrl);
  }, [photosKey, sceneReady]);

  // --- tap routing ----------------------------------------------------------------

  const drill = drillDownCodes ?? DEFAULT_DRILLDOWN;
  onTapRef.current = (hit: GlobeTapHit) => {
    const scene = sceneRef.current;
    if (hit.kind === "photo") {
      onOpenPhoto?.(hit.photo);
      return;
    }
    if (hit.kind === "cluster") {
      // Zoom separates the stack; if we're already at the ground and the
      // photos truly share a spot, open the newest one instead of stalling.
      if (scene && !scene.isNearMinZoom()) scene.flyTo(hit.lat, hit.lng);
      else onOpenPhoto?.(hit.photos[0]);
      return;
    }
    if (hit.kind === "pin") {
      const pin = allPins.find((p) => p.id === hit.pinId);
      if (pin) {
        beginSheetMuniResolve(pin.lat, pin.lng);
        setSheet({ mode: "view", pin });
      }
      return;
    }
    void handleSurfaceTap(hit.lat, hit.lng);
  };

  async function handleSurfaceTap(lat: number, lng: number): Promise<void> {
    const code = await lookupCountry(lat, lng);
    if (!sceneRef.current) return; // unmounted while resolving
    if (code && visited.has(code) && drill.includes(code) && onOpenCountry) {
      onOpenCountry(code);
      return;
    }
    // Code already resolved — the sheet opens without a "locating…" phase.
    beginSheetMuniResolve(lat, lng);
    setSheet({ mode: "new", lat, lng, countryCode: code, resolving: false });
  }

  /** FAB / empty-state CTA: record an encounter at whatever faces the camera. */
  function handleAddAtCenter(): void {
    const scene = sceneRef.current;
    if (!scene) return;
    const { lat, lng } = scene.getCenterLatLng();
    beginSheetMuniResolve(lat, lng);
    setSheet({ mode: "new", lat, lng, countryCode: "", resolving: true });
    void lookupCountry(lat, lng).then((code) => {
      setSheet((s) => (s && s.mode === "new" && s.lat === lat && s.lng === lng ? { ...s, countryCode: code, resolving: false } : s));
    });
  }

  // --- stats + celebration ---------------------------------------------------------

  // Hero metric: municipalities · countries (the exploration UNIT count — a
  // world-% would round to 0 forever). Renders instantly with whatever the
  // resolver already knows; fills in progressively while `resolving`.
  const exploration = useExplorationStats();

  const exactPct = statsWorld && statsWorld.length > 0 ? (visited.size / statsWorld.length) * 100 : 0;
  const pct = Math.round(exactPct);
  // Unrounded width so the very first country moves the needle (1/177 rounds
  // to 0%) — a sliver of gold beats an empty track.
  const barPct = visited.size > 0 ? Math.max(exactPct, 1.5) : 0;

  const prevPctRef = useRef<number | null>(null);
  const [celebrate, setCelebrate] = useState<"" | "pulse" | "milestone">("");
  useEffect(() => {
    if (!statsWorld) return;
    const prev = prevPctRef.current;
    prevPctRef.current = pct;
    if (prev === null || pct <= prev) return;
    setCelebrate(Math.floor(pct / 10) > Math.floor(prev / 10) ? "milestone" : "pulse");
    const timer = setTimeout(() => setCelebrate(""), REVEAL_ANIM_MS);
    return () => clearTimeout(timer);
  }, [pct, statsWorld]);

  // The hero count deserves the same dopamine: pulse when a NEW municipality
  // joins. Primed on the first value, and suppressed while the background
  // back-fill of old memories is running — only a fresh footprint celebrates.
  const prevMuniRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevMuniRef.current;
    prevMuniRef.current = exploration.municipalitiesVisited;
    if (prev === null || exploration.resolving || exploration.municipalitiesVisited <= prev) return;
    setCelebrate("pulse");
    const timer = setTimeout(() => setCelebrate(""), REVEAL_ANIM_MS);
    return () => clearTimeout(timer);
  }, [exploration.municipalitiesVisited, exploration.resolving]);

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

  function labelFor(code: string, resolving?: boolean): string {
    if (resolving) return t("map.sheet.locating");
    if (!code) return t("map.sheet.ocean");
    return countryName(code, lang);
  }

  /** Sheet location line: "Shinjuku · Japan" once the municipality resolves,
   *  plain country (or ocean / locating…) until then. */
  function sheetLocationLabel(target: SheetTarget): string {
    const base =
      target.mode === "view" ? labelFor(target.pin.countryCode) : labelFor(target.countryCode, target.resolving);
    const stillLocating = target.mode === "new" && target.resolving;
    if (!sheetMuni || stillLocating) return base;
    return t("globe.sheet.place", { muni: sheetMuni.name, country: base });
  }

  const ready = sceneReady && renderWorld !== null;

  return (
    <div class="screen map-screen">
      <div class="map-viewport globe-viewport">
        <div ref={hostRef} class="globe-canvas-host" role="application" aria-label={t("globe.aria")} />
        <div class="globe-vignette" aria-hidden="true" />

        {!ready && !worldError && !glError && <p class="map-loading">{t("map.loading")}</p>}
        {worldError && !glError && <p class="map-error">{t("map.error")}</p>}
        {glError && <p class="map-error">{t("globe.error")}</p>}

        {ready && statsWorld && (
          <div class={["panel", "panel-tight", "map-stat-card", celebrate ? `map-stat-card--${celebrate}` : ""].filter(Boolean).join(" ")}>
            <h1 class="map-stat-card__title">{t("map.title")}</h1>
            <p class="map-stat-card__main">
              {t("globe.stats.hero", {
                munis: exploration.municipalitiesVisited,
                countries: exploration.countriesVisited,
              })}
            </p>
            {exploration.resolving && <p class="globe-stat-counting">{t("globe.stats.counting")}</p>}
            <p class="globe-stat-sub">{t("map.explored", { count: visited.size, total: statsWorld.length, pct })}</p>
            {/* Decorative: the stat lines above already carry the numbers. */}
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
          </div>
        )}

        {ready && allPins.length === 0 && (
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

      {ready && (
        <button type="button" class="fab" onClick={handleAddAtCenter}>
          <MapPin size={22} />
          <span class="fab-label">{t("map.fab.add")}</span>
        </button>
      )}

      {sheet && (
        <EncounterSheet
          target={sheet}
          locationLabel={sheetLocationLabel(sheet)}
          // addPinAuto routes to the room's Y.Doc in a party and the local
          // solo store otherwise — capture always works, unlike the old map.
          canSave={sheet.mode === "new"}
          canDelete={
            sheet.mode === "view" &&
            sheet.pin.by === profile.id &&
            (roomPins.some((p) => p.id === sheet.pin.id) || localPins.some((p) => p.id === sheet.pin.id))
          }
          onClose={closeSheet}
          onSave={(data) => {
            if (sheet.mode !== "new") return;
            addPinAuto({ lat: sheet.lat, lng: sheet.lng, countryCode: sheet.countryCode, ...data });
            closeSheet();
          }}
          onDelete={() => {
            if (sheet.mode !== "view") return;
            // Route to whichever store owns this pin (solo pins live locally).
            if (localPins.some((p) => p.id === sheet.pin.id)) removeLocalPin(sheet.pin.id);
            else removePin(sheet.pin.id);
            closeSheet();
          }}
        />
      )}
    </div>
  );
}

// Worldwide exploration stats at the municipality (admin-2) unit.
//
// The headline is a COUNT — "N 市町村 · M カ国 explored" — not a world percentage
// (that would round to ~0% forever). Per-country coverage ("Japan 12/1745") is
// the domestic-depth lens on top.
//
// The unit of exploration is a municipality a traveller has a memory in. Points
// come from the unified journey (pins + geo-tagged photos + geo diary, room AND
// solo), and each is resolved to its municipality by the dynamic resolver
// (geo/municipalResolver.ts): vendored for Japan, dynamically fetched + cached
// for everywhere else.
//
// This hook NEVER blocks: it renders instantly with whatever the resolver has
// already answered (offline-safe, from the persistent resolved-index), kicks off
// background resolution for anything unresolved, and updates reactively as those
// land (`resolving` stays true until the in-flight work settles). Country counts
// come straight from each point's countryCode, so a country with no ADM2 data
// still counts toward "M カ国" even when its municipalities can't be resolved.
import { useEffect, useRef, useState } from "preact/hooks";
import { countryName } from "./geo";
import { getLanguage, useT } from "./i18n";
import { useUnifiedJourney } from "./memories";
import {
  ensureCountryAdmin2,
  pointKey,
  resolveMunicipality,
  resolvedForPoint,
  subscribeResolved,
  type ResolvedMunicipality,
} from "./geo/municipalResolver";
// Vendored ADM2 unit counts (the per-country denominator + world total). Parsed
// from ?raw like geo.ts's atlas — tsconfig.app has no resolveJsonModule.
// eslint-disable-next-line import/no-unresolved -- Vite `?raw` loader
import admin2CountsRaw from "./geo/admin2Counts.json?raw";

interface Admin2Counts {
  worldTotal: number;
  counts: Record<string, number>;
}
const ADMIN2_COUNTS = JSON.parse(admin2CountsRaw) as Admin2Counts;

/** One country's domestic-depth coverage: distinct municipalities visited over
 *  that country's total admin-2 unit count. */
export interface PerCountryCoverage {
  /** ISO 3166-1 alpha-2 lowercase */
  cc: string;
  /** localized country display name */
  name: string;
  visited: number;
  total: number;
}

export interface ExplorationStats {
  /** distinct municipalities with at least one memory, worldwide (the headline) */
  municipalitiesVisited: number;
  /** distinct countries visited (from point countryCodes; no ADM2 needed) */
  countriesVisited: number;
  /** total admin-2 units on Earth per geoBoundaries (soft denominator, ~info-only) */
  worldMunicipalityTotal: number;
  /** per-country coverage, richest first */
  perCountry: PerCountryCoverage[];
  /** true while background boundary fetch / resolution is still in flight */
  resolving: boolean;
}

/** A visited point reduced to what exploration counting needs. */
export interface ExplorationPoint {
  lat: number;
  lng: number;
  /** ISO 3166-1 alpha-2 lowercase; "" if the point's country is unresolved */
  countryCode: string;
}

/** Pure aggregation — distinct municipality + country counting and per-country
 *  coverage — with every dependency injected, so it unit-tests without hooks,
 *  storage, or the network. `resolveFn` is the synchronous resolved-index lookup,
 *  `totalOf` the per-country denominator, `nameOf` the display name. */
export function aggregateExploration(
  points: readonly ExplorationPoint[],
  resolveFn: (lat: number, lng: number) => ResolvedMunicipality | null,
  totalOf: (cc: string) => number,
  nameOf: (cc: string) => string,
): Pick<ExplorationStats, "municipalitiesVisited" | "countriesVisited" | "perCountry"> {
  const countrySet = new Set<string>();
  const muniByCountry = new Map<string, Set<string>>();

  for (const p of points) {
    if (p.countryCode) countrySet.add(p.countryCode);
    const r = resolveFn(p.lat, p.lng);
    if (!r) continue;
    countrySet.add(r.countryCode);
    let set = muniByCountry.get(r.countryCode);
    if (!set) {
      set = new Set();
      muniByCountry.set(r.countryCode, set);
    }
    set.add(r.code);
  }

  let municipalitiesVisited = 0;
  for (const set of muniByCountry.values()) municipalitiesVisited += set.size;

  const perCountry: PerCountryCoverage[] = [...countrySet]
    .map((cc) => ({
      cc,
      name: nameOf(cc),
      visited: muniByCountry.get(cc)?.size ?? 0,
      total: totalOf(cc),
    }))
    .sort((a, b) => b.visited - a.visited || a.name.localeCompare(b.name));

  return { municipalitiesVisited, countriesVisited: countrySet.size, perCountry };
}

/** The per-country denominator: prefer the actually-loaded boundary count (the
 *  authoritative "what's resolvable" number, so coverage can never exceed 100%),
 *  falling back to the vendored geoBoundaries count before the data lands. */
function totalFor(cc: string, loaded: Map<string, number>): number {
  return loaded.get(cc) ?? ADMIN2_COUNTS.counts[cc] ?? 0;
}

function collectPoints(journey: ReturnType<typeof useUnifiedJourney>): ExplorationPoint[] {
  const points: ExplorationPoint[] = [];
  for (const pin of journey.pins) {
    points.push({ lat: pin.lat, lng: pin.lng, countryCode: pin.countryCode });
  }
  for (const ph of journey.photos) {
    if (ph.geo) points.push({ lat: ph.geo.lat, lng: ph.geo.lng, countryCode: ph.geo.countryCode });
  }
  for (const d of journey.diary) {
    if (d.geo) points.push({ lat: d.geo.lat, lng: d.geo.lng, countryCode: d.geo.countryCode });
  }
  return points;
}

/** The reactive exploration stats hook. Reads the unified journey, resolves each
 *  point's municipality (background, cached, offline-safe), and returns counts +
 *  per-country coverage that update as resolutions land. Renders instantly with
 *  whatever's already resolved; `resolving` reports background progress. */
export function useExplorationStats(): ExplorationStats {
  const journey = useUnifiedJourney();
  useT(); // re-render on language change so country names re-localize
  const lang = getLanguage();

  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);
  const [resolving, setResolving] = useState(false);
  // Boundary counts learned as countries' data loads — the preferred denominator.
  const loadedTotals = useRef(new Map<string, number>());

  const points = collectPoints(journey);
  // Stable dependency: the multiset of rounded point keys. Changes exactly when
  // a point is added / moved / removed, re-driving the background resolve pass.
  const pointsSig = points
    .map((p) => pointKey(p.lat, p.lng))
    .sort()
    .join("|");

  // Re-render when a background resolution lands (the index changed).
  useEffect(() => subscribeResolved(rerender), []);

  useEffect(() => {
    let cancelled = false;

    // Warm the per-country denominators for every visited country, whether or
    // not any of its points resolve to a municipality.
    const visitedCcs = new Set(points.map((p) => p.countryCode).filter(Boolean));
    for (const cc of visitedCcs) {
      if (loadedTotals.current.has(cc)) continue;
      void ensureCountryAdmin2(cc).then((features) => {
        if (cancelled || !features) return;
        loadedTotals.current.set(cc, features.length);
        rerender();
      });
    }

    // Resolve each not-yet-resolved point in the background.
    const unresolved = points.filter((p) => !resolvedForPoint(p.lat, p.lng));
    if (unresolved.length === 0) {
      setResolving(false);
      return () => {
        cancelled = true;
      };
    }
    setResolving(true);
    let pending = unresolved.length;
    for (const p of unresolved) {
      void resolveMunicipality(p.lat, p.lng).finally(() => {
        if (cancelled) return;
        pending -= 1;
        if (pending === 0) setResolving(false);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pointsSig captures the point set
  }, [pointsSig]);

  const { municipalitiesVisited, countriesVisited, perCountry } = aggregateExploration(
    points,
    resolvedForPoint,
    (cc) => totalFor(cc, loadedTotals.current),
    (cc) => countryName(cc, lang),
  );

  return {
    municipalitiesVisited,
    countriesVisited,
    worldMunicipalityTotal: ADMIN2_COUNTS.worldTotal,
    perCountry,
    resolving,
  };
}

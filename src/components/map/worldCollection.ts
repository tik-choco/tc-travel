// Shared "which countries has the traveller visited" derivation for the world
// brag card feature. WorldMap (SVG fallback), MapScreen (globe path's trigger
// button) and WorldBragCard each need this set independently — one hook so
// they can never drift into slightly different definitions of "visited".
import { useMemo } from "preact/hooks";
import { useUnifiedJourney } from "../../lib/memories";

/** Country codes (ISO 3166-1 alpha-2 lowercase) resolved from every pin,
 *  geo-tagged photo and geo-tagged diary entry in the unified journey (room +
 *  solo, already folded together by useUnifiedJourney). */
export function useVisitedCountries(): Set<string> {
  const journey = useUnifiedJourney();
  return useMemo(() => {
    const s = new Set<string>();
    for (const p of journey.pins) if (p.countryCode) s.add(p.countryCode);
    for (const p of journey.photos) if (p.geo?.countryCode) s.add(p.geo.countryCode);
    for (const d of journey.diary) if (d.geo?.countryCode) s.add(d.geo.countryCode);
    return s;
  }, [journey.pins, journey.photos, journey.diary]);
}

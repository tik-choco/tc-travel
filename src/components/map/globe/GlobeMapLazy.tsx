// Lazy wrapper so three.js + the 50m atlas stay out of the main bundle — the
// globe chunk only downloads when the map tab actually opens. Mirrors
// HomeVrmStageLazy. Styles for the placeholder/failure states come from
// globe.css (imported HERE, not just in GlobeMap, so they exist even when the
// heavy chunk never arrives).
import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { useT } from "../../../lib/i18n";
import type { GlobeMapProps } from "./GlobeMap";
import "./globe.i18n";
import "./globe.css";

let cached: ComponentType<GlobeMapProps> | null = null;

export function GlobeMapLazy(props: GlobeMapProps) {
  const t = useT();
  const [Globe, setGlobe] = useState<ComponentType<GlobeMapProps> | null>(() => cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Globe) return;
    let alive = true;
    import("./GlobeMap")
      .then((mod) => {
        cached = mod.GlobeMap;
        if (alive) setGlobe(() => mod.GlobeMap);
      })
      .catch(() => {
        // Chunk failed to load (offline, deploy skew) — say so; the
        // orchestrator may separately choose the SVG map on retry.
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [Globe]);

  if (!Globe) {
    return (
      <div class="screen globe-shell">
        <div class={`globe-viewport${failed ? "" : " globe-viewport--loading"}`}>
          {failed && <p class="globe-fallback-msg">{t("globe.loadError")}</p>}
        </div>
      </div>
    );
  }
  return <Globe {...props} />;
}

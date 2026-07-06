// Lazy wrapper so three.js + @pixiv/three-vrm stay out of the initial Home
// bundle — users without a VRM never download the 3D stack on the landing
// screen. Mirrors ARCameraLazy.tsx.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import type { HomeVrmStageProps } from "./HomeVrmStage";

let cached: ComponentType<HomeVrmStageProps> | null = null;

export function HomeVrmStageLazy(props: HomeVrmStageProps) {
  const [Stage, setStage] = useState<ComponentType<HomeVrmStageProps> | null>(() => cached);
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;

  useEffect(() => {
    if (Stage) return;
    let alive = true;
    import("./HomeVrmStage")
      .then((mod) => {
        cached = mod.HomeVrmStage;
        if (alive) setStage(() => mod.HomeVrmStage);
      })
      .catch(() => {
        // Chunk failed to load (offline, deploy skew) — fall back to portrait.
        if (alive) onErrorRef.current();
      });
    return () => {
      alive = false;
    };
  }, [Stage]);

  // Same shimmer as the stage's parse phase, so module-load and VRM-parse
  // read as one continuous loading state.
  if (!Stage) return <div class="home-vrm-canvas is-loading" aria-hidden="true" />;
  return <Stage {...props} />;
}

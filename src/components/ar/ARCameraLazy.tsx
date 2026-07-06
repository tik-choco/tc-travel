// Lazy wrapper so three.js + @pixiv/three-vrm (the heaviest chunk by far)
// are only downloaded when the Summoning Circle tab is first opened.
import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { useT } from "../../lib/i18n";
import "./ar.i18n";

let cached: ComponentType | null = null;

export function ARCameraLazy() {
  const t = useT();
  const [Screen, setScreen] = useState<ComponentType | null>(() => cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Screen) return;
    let alive = true;
    import("./ARCameraScreen")
      .then((mod) => {
        cached = mod.ARCameraScreen;
        if (alive) setScreen(() => mod.ARCameraScreen);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [Screen]);

  if (failed) {
    return (
      <div class="screen">
        <div class="panel">{t("error.connection")}</div>
      </div>
    );
  }
  if (!Screen) {
    return (
      <div class="screen ar-lazy-loading">
        <div class="panel">{t("ar.summonLoading")}</div>
      </div>
    );
  }
  return <Screen />;
}

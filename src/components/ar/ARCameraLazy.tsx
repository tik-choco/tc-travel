// Lazy wrapper so three.js + @pixiv/three-vrm (the heaviest chunk by far) are
// only downloaded when the AR capture overlay is first opened from the Avatar
// hub. The overlay renders fixed over the whole shell, so its loading/failed
// states must too (hence .ar-capture on the fallbacks).
import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { LoaderCircle, X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import "./ar.i18n";
import "./ar.css";

interface Props {
  /** Dismiss the overlay, returning to the Avatar hub. */
  onClose: () => void;
}

let cached: ComponentType<Props> | null = null;

export function ARCameraLazy({ onClose }: Props) {
  const t = useT();
  const [Screen, setScreen] = useState<ComponentType<Props> | null>(() => cached);
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
      <div class="ar-screen ar-capture ar-screen-loading">
        <button type="button" class="ar-icon-btn ar-close-floating" onClick={onClose} aria-label={t("ar.close")}>
          <X size={20} />
        </button>
        <div class="panel">{t("error.connection")}</div>
      </div>
    );
  }
  if (!Screen) {
    return (
      <div class="ar-screen ar-capture ar-screen-loading">
        <button type="button" class="ar-icon-btn ar-close-floating" onClick={onClose} aria-label={t("ar.close")}>
          <X size={20} />
        </button>
        <LoaderCircle class="spin" size={28} />
      </div>
    );
  }
  return <Screen onClose={onClose} />;
}

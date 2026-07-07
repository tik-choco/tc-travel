// Lazy wrapper so three.js + @pixiv/three-vrm (the heaviest chunk by far) are
// only downloaded when the Avatar hub is first opened. Mirrors ARCameraLazy.
import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { LoaderCircle } from "lucide-preact";
import { useT } from "../../lib/i18n";
import "./avatar.i18n";
import "./avatar.css";

let cached: ComponentType | null = null;

export function AvatarScreenLazy() {
  const t = useT();
  const [Screen, setScreen] = useState<ComponentType | null>(() => cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Screen) return;
    let alive = true;
    import("./AvatarScreen")
      .then((mod) => {
        cached = mod.AvatarScreen;
        if (alive) setScreen(() => mod.AvatarScreen);
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
      <div class="avatar-screen avatar-screen-loading">
        <div class="panel">{t("error.connection")}</div>
      </div>
    );
  }
  if (!Screen) {
    return (
      <div class="avatar-screen avatar-screen-loading">
        <LoaderCircle class="avatar-spin" size={28} />
      </div>
    );
  }
  return <Screen />;
}

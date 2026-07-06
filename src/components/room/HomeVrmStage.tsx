// Three.js VRM hero stage for the Home screen: parses the stored VRM bytes,
// frames the camera on a cozy upper-body portrait, and lets the companion's
// built-in idle breathing/blink greet the user. This module (transitively)
// pulls in three.js + @pixiv/three-vrm — it must only ever be reached through
// HomeVrmStageLazy's dynamic import() so the landing bundle stays light.

import { useEffect, useRef, useState } from "preact/hooks";
import { Vector3 } from "three";
import { createArScene } from "../ar/arScene";
import { createVrmCompanion, loadVrmFromBytes } from "../ar/vrmLoader";
import type { Companion } from "../ar/companion";

export interface HomeVrmStageProps {
  bytes: Uint8Array;
  /** Parsing failed — Home falls back to the portrait hero. */
  onError: () => void;
}

/** Fallback eye level when a model has no humanoid head bone. */
const DEFAULT_HEAD_Y = 1.3;

export function HomeVrmStage({ bytes, onError }: HomeVrmStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [headY, setHeadY] = useState(DEFAULT_HEAD_Y);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);

  // Keep the latest onError without re-parsing when Home re-renders with a
  // fresh inline callback.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Parse bytes → VRM → companion once; GPU resources are released on unmount.
  useEffect(() => {
    let alive = true;
    let created: Companion | null = null;
    loadVrmFromBytes(bytes)
      .then((vrm) => {
        const next = createVrmCompanion(vrm);
        if (!alive) {
          next.dispose();
          return;
        }
        created = next;
        // Frame relative to the head bone so short and tall models both get
        // the same friendly bust portrait.
        vrm.scene.updateMatrixWorld(true);
        const head = vrm.humanoid?.getNormalizedBoneNode("head");
        setHeadY(head ? head.getWorldPosition(new Vector3()).y : DEFAULT_HEAD_Y);
        setCompanion(next);
      })
      .catch((err) => {
        console.error("tc-travel: home VRM load failed", err);
        if (alive) onErrorRef.current();
      });
    return () => {
      alive = false;
      created?.dispose();
    };
  }, [bytes]);

  // Scene lives only while the page is visible: arScene's RAF loop has no
  // pause API, so hiding the tab tears the scene down (dispose removes the
  // companion without disposing it) and returning rebuilds it — no re-parse.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !companion || !pageVisible) return;
    const arScene = createArScene(container);
    // Cozy bust framing: chest at center, head in the upper third.
    arScene.camera.position.set(0, headY - 0.05, 0.95);
    arScene.camera.lookAt(0, headY - 0.16, 0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Still pose: step the companion once so the model settles, then stop —
      // no breathing or blinking for motion-sensitive users.
      let stepped = false;
      arScene.setCompanion({
        root: companion.root,
        update(deltaSeconds, elapsedSeconds) {
          if (stepped) return;
          stepped = true;
          companion.update(deltaSeconds, elapsedSeconds);
        },
        dispose() {},
      });
    } else {
      arScene.setCompanion(companion);
    }
    return () => arScene.dispose();
  }, [companion, headY, pageVisible]);

  return <div ref={containerRef} class={`home-vrm-canvas${companion ? "" : " is-loading"}`} aria-hidden="true" />;
}

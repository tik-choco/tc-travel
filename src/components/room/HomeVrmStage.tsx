// Three.js VRM hero stage for the Home screen: parses the stored VRM bytes,
// frames the camera on a cozy upper-body portrait, and lets the companion's
// built-in idle breathing/blink greet the user. This module (transitively)
// pulls in three.js + @pixiv/three-vrm — it must only ever be reached through
// HomeVrmStageLazy's dynamic import() so the landing bundle stays light.

import { useEffect, useRef, useState } from "preact/hooks";
import { Vector3 } from "three";
import type { Object3D } from "three";
import { createArScene } from "../ar/arScene";
import { createPlaceholderCompanion } from "../ar/placeholderCompanion";
import { createVrmCompanion, loadVrmFromBytes } from "../ar/vrmLoader";
import type { Companion } from "../ar/companion";

export interface HomeVrmStageProps {
  /** VRM bytes to parse. When omitted, the zero-setup placeholder companion
   *  greets the user instead — so the reward is visible even with no .vrm. */
  bytes?: Uint8Array;
  /** Parsing failed — Home re-renders the stage with bytes=undefined so the
   *  placeholder companion takes over. */
  onError: () => void;
  /** Whether the companion's idle breathing/blink loop may play. Before the
   *  companionWake unlock (lib/unlocks.ts) it renders as a still portrait —
   *  the companion is "asleep" until your journey begins. Defaults to true so
   *  existing callers keep the lively behaviour. */
  animate?: boolean;
}

/** Fallback eye level when a model has no humanoid head bone. */
const DEFAULT_HEAD_Y = 1.3;
/** Eye level for the procedural golem (its head sphere sits ~1.08 high) so the
 *  camera frames the same cozy bust portrait as a VRM. */
const PLACEHOLDER_HEAD_Y = 1.15;

/** Dim the placeholder golem's materials so an "asleep" companion (pre-wake)
 *  reads as dormant, not just motionless. Returns a restore fn so the same
 *  companion instance brightens on wake without being rebuilt. */
function applyDormantLook(root: Object3D): () => void {
  const restores: Array<() => void> = [];
  root.traverse((obj) => {
    const material = (obj as unknown as { material?: unknown }).material as
      | { emissiveIntensity?: number; color?: { getHex(): number; setHex(hex: number): void; multiplyScalar(scalar: number): void } }
      | undefined;
    if (!material || typeof material.emissiveIntensity !== "number" || !material.color) return;
    const prevEmissive = material.emissiveIntensity;
    const prevColor = material.color.getHex();
    material.emissiveIntensity = 0;
    material.color.multiplyScalar(0.72);
    restores.push(() => {
      material.emissiveIntensity = prevEmissive;
      material.color!.setHex(prevColor);
    });
  });
  return () => restores.forEach((restore) => restore());
}

export function HomeVrmStage({ bytes, onError, animate = true }: HomeVrmStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [headY, setHeadY] = useState(DEFAULT_HEAD_Y);
  const [isPlaceholder, setIsPlaceholder] = useState(false);
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

  // Build the companion once: parse bytes → VRM, or (no bytes) the procedural
  // placeholder golem. GPU resources are released on unmount.
  useEffect(() => {
    let alive = true;
    let created: Companion | null = null;
    if (!bytes) {
      const placeholder = createPlaceholderCompanion();
      created = placeholder;
      setIsPlaceholder(true);
      setHeadY(PLACEHOLDER_HEAD_Y);
      setCompanion(placeholder);
      return () => {
        alive = false;
        // Clear the state too so the scene never renders a disposed golem
        // while late-arriving VRM bytes are still parsing.
        setCompanion(null);
        created?.dispose();
      };
    }
    setIsPlaceholder(false);
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
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Placeholder golem only: dim it while asleep (pre-wake) so it reads as
    // dormant. A VRM asleep just holds a still portrait, matching prior behaviour.
    const restoreDormant = isPlaceholder && !animate ? applyDormantLook(companion.root) : null;
    // Set when the awake-placeholder branch nudges the root: puts the transform
    // back on teardown so visibility-driven scene rebuilds never drift.
    let swayReset: (() => void) | null = null;
    if (reducedMotion || !animate) {
      // Still pose: step the companion once so the model settles, then stop —
      // no breathing or blinking. Used both for motion-sensitive users and
      // before the companionWake unlock (the companion is "asleep" until the
      // journey begins).
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
    } else if (isPlaceholder) {
      // Awake placeholder: a gentle stage-level sine bob/sway on the root, on
      // top of the golem's own idle — subtle and cozy, nothing elaborate.
      const baseY = companion.root.position.y;
      const baseRotY = companion.root.rotation.y;
      swayReset = () => {
        companion.root.position.y = baseY;
        companion.root.rotation.y = baseRotY;
      };
      arScene.setCompanion({
        root: companion.root,
        update(deltaSeconds, elapsedSeconds) {
          companion.update(deltaSeconds, elapsedSeconds);
          companion.root.position.y = baseY + Math.sin(elapsedSeconds * 1.1) * 0.012;
          companion.root.rotation.y = baseRotY + Math.sin(elapsedSeconds * 0.5) * 0.05;
        },
        dispose() {},
      });
    } else {
      arScene.setCompanion(companion);
    }
    return () => {
      arScene.dispose();
      swayReset?.();
      restoreDormant?.();
    };
  }, [companion, headY, pageVisible, animate, isPlaceholder]);

  return <div ref={containerRef} class={`home-vrm-canvas${companion ? "" : " is-loading"}`} aria-hidden="true" />;
}

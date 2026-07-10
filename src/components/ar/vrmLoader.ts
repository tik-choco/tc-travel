// Adapted from tc-vrm-viewer's src/viewer/vrmLoader.ts: same GLTFLoader +
// VRMLoaderPlugin + VRMUtils cleanup pipeline, plus standing idle motion/blink
// animation and adaptation to the shared Companion contract.

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { createIdleMotion } from "./idleMotion";
import type { Companion } from "./companion";

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

export async function loadVrmFromBytes(bytes: Uint8Array): Promise<VRM> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await loader.parseAsync(arrayBuffer, "");
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);
  VRMUtils.rotateVRM0(vrm); // no-op for VRM 1.0 models
  vrm.scene.traverse((object) => {
    object.frustumCulled = false;
  });
  return vrm;
}

function randomBlinkInterval(): number {
  return 2 + Math.random() * 3;
}

/** Standing idle motion (arms down + spine/chest/head sway) + auto-blink, safe on models missing either. */
function createIdleAnimator(vrm: VRM): (deltaSeconds: number, elapsedSeconds: number) => void {
  const stepMotion = createIdleMotion(vrm);

  const hasBlink = Boolean(vrm.expressionManager?.expressionMap["blink"]);
  let blinkTimer = randomBlinkInterval();
  let blinkElapsed = 0;
  let phase: "idle" | "closing" | "opening" = "idle";
  let phaseElapsed = 0;
  const closeDuration = 0.08;
  const openDuration = 0.12;

  return (deltaSeconds, elapsedSeconds) => {
    stepMotion(elapsedSeconds);

    if (!hasBlink) return;
    if (phase === "idle") {
      blinkElapsed += deltaSeconds;
      if (blinkElapsed >= blinkTimer) {
        phase = "closing";
        phaseElapsed = 0;
      }
      return;
    }
    phaseElapsed += deltaSeconds;
    if (phase === "closing") {
      const weight = Math.min(1, phaseElapsed / closeDuration);
      vrm.expressionManager?.setValue("blink", weight);
      if (weight >= 1) {
        phase = "opening";
        phaseElapsed = 0;
      }
      return;
    }
    const weight = Math.max(0, 1 - phaseElapsed / openDuration);
    vrm.expressionManager?.setValue("blink", weight);
    if (weight <= 0) {
      phase = "idle";
      blinkElapsed = 0;
      blinkTimer = randomBlinkInterval();
    }
  };
}

export function createVrmCompanion(vrm: VRM): Companion {
  const stepIdle = createIdleAnimator(vrm);
  const hasMouth = Boolean(vrm.expressionManager?.expressionMap["aa"]);
  let mouthLevel = 0;
  return {
    root: vrm.scene,
    update(deltaSeconds, elapsedSeconds) {
      stepIdle(deltaSeconds, elapsedSeconds);
      // expressionManager applies queued values inside vrm.update(), so "aa"
      // must be set before that call.
      if (hasMouth) vrm.expressionManager?.setValue("aa", mouthLevel);
      vrm.update(deltaSeconds);
    },
    setMouthLevel(level) {
      if (hasMouth) mouthLevel = level;
    },
    dispose() {
      VRMUtils.deepDispose(vrm.scene);
    },
  };
}

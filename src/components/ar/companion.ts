// Shared contract between the VRM companion and the procedural placeholder
// golem, so gestures/scene code can manipulate either uniformly.

import type * as THREE from "three";

export const MIN_DISTANCE = 0.5;
export const MAX_DISTANCE = 6;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 3;

export interface Companion {
  /** Root object placed in the AR scene; gestures move/scale/rotate this directly. */
  root: THREE.Object3D;
  /** Called once per frame for idle animation (breathing, blinking, bobbing). */
  update(deltaSeconds: number, elapsedSeconds: number): void;
  /** Release GPU resources (geometries/materials/textures). */
  dispose(): void;
  /** 発話リップシンク用の口の開き(0..1)。毎フレーム上書きされる前提の生値。 */
  setMouthLevel?(level: number): void;
}

export function clampScale(factor: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, factor));
}

export function clampDistance(distance: number): number {
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
}

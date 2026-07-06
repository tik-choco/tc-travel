// Pointer-event gestures on the AR overlay: one-finger drag moves the
// companion on the ground plane, two-finger pinch scales it, two-finger
// twist rotates it around Y. Desktop fallback buttons reuse rotateStep /
// zoomStep directly.

import * as THREE from "three";
import { clampDistance, clampScale } from "./companion";

interface PointerState {
  x: number;
  y: number;
}

export interface GestureHandle {
  dispose(): void;
}

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function attachGestures(
  element: HTMLElement,
  camera: THREE.PerspectiveCamera,
  getTarget: () => THREE.Object3D | null,
): GestureHandle {
  const pointers = new Map<number, PointerState>();
  let pinchStartDistance = 0;
  let pinchStartAngle = 0;
  let pinchStartScale = 1;

  function screenToNdc(x: number, y: number): THREE.Vector2 {
    const rect = element.getBoundingClientRect();
    return new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  }

  function dragTo(x: number, y: number): void {
    const target = getTarget();
    if (!target) return;
    raycaster.setFromCamera(screenToNdc(x, y), camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
    let dx = hit.x - camera.position.x;
    let dz = hit.z - camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;
    const ratio = clampDistance(dist) / dist;
    dx *= ratio;
    dz *= ratio;
    target.position.set(camera.position.x + dx, target.position.y, camera.position.z + dz);
  }

  function pinchMetrics(): { distance: number; angle: number } | null {
    const pts = [...pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  }

  function onPointerDown(e: PointerEvent): void {
    element.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const metrics = pinchMetrics();
      const target = getTarget();
      if (metrics && target) {
        pinchStartDistance = metrics.distance;
        pinchStartAngle = metrics.angle;
        pinchStartScale = target.scale.x;
      }
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      dragTo(e.clientX, e.clientY);
      return;
    }
    if (pointers.size === 2) {
      const target = getTarget();
      const metrics = pinchMetrics();
      if (!target || !metrics || pinchStartDistance <= 0) return;
      target.scale.setScalar(clampScale(pinchStartScale * (metrics.distance / pinchStartDistance)));
      target.rotation.y += metrics.angle - pinchStartAngle;
      pinchStartAngle = metrics.angle;
    }
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDistance = 0;
  }

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);

  return {
    dispose() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
    },
  };
}

/** Desktop fallback: rotate the companion around Y by a fixed step. */
export function rotateStep(target: THREE.Object3D, radians: number): void {
  target.rotation.y += radians;
}

/** Desktop fallback: move the companion nearer/farther along its ray from the camera. */
export function zoomStep(target: THREE.Object3D, camera: THREE.PerspectiveCamera, factor: number): void {
  const dx = target.position.x - camera.position.x;
  const dz = target.position.z - camera.position.z;
  const dist = Math.hypot(dx, dz) || 1;
  const ratio = clampDistance(dist * factor) / dist;
  target.position.set(camera.position.x + dx * ratio, target.position.y, camera.position.z + dz * ratio);
}

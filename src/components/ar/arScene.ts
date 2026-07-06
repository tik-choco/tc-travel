// Transparent three.js overlay compositing on top of the camera <video>.
// No WebXR — this is plain camera-video + WebGL compositing (works on iOS
// Safari, unlike WebXR).

import * as THREE from "three";
import type { Companion } from "./companion";

export interface ArScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  setCompanion(companion: Companion | null): void;
  dispose(): void;
}

export function createArScene(container: HTMLElement): ArScene {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
  camera.position.set(0, 1.4, 2.2);
  camera.lookAt(0, 1, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const canvas = renderer.domElement;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const ambient = new THREE.AmbientLight(0xfff2d9, 0.9);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 1.1);
  directional.position.set(1, 2, 1.5);
  scene.add(directional);

  let companion: Companion | null = null;

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const clock = new THREE.Clock();
  let elapsedSeconds = 0;
  let frameId = 0;
  function tick(): void {
    const deltaSeconds = clock.getDelta();
    elapsedSeconds += deltaSeconds;
    companion?.update(deltaSeconds, elapsedSeconds);
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(tick);
  }
  frameId = requestAnimationFrame(tick);

  return {
    scene,
    camera,
    renderer,
    canvas,
    setCompanion(next) {
      if (companion) scene.remove(companion.root);
      companion = next;
      if (companion) scene.add(companion.root);
    },
    dispose() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      if (companion) scene.remove(companion.root);
      renderer.dispose();
      canvas.remove();
    },
  };
}

// The imperative Three.js globe: an area-honest equirectangular parchment
// atlas wrapped on a UV sphere, orbit-drag + dolly-zoom camera that turns
// map-like up close, encounter pins, polaroid photo billboards, and the
// fog-reveal flourish when a new country unlocks. Framework-free — the
// GlobeMap component owns hooks/data and feeds this scene through setters.
//
// Follows arScene.ts's lifecycle idiom (renderer creation, ResizeObserver,
// full disposal) with three additions this screen needs: render-on-demand
// (RAF ticks always, but draws only when something changed), a document.
// hidden pause, and WebGL context-loss recovery.

import * as THREE from "three";
import type { CountryFeature } from "../../../lib/geo";
import type { AlbumPhoto } from "../../../lib/types";
import { clamp } from "../geoMath";
import { geometryAnchor, latLngToVec3, shortestAngle, vec3ToLatLng, type LatLng } from "./geoSphere";
import {
  buildCountryPaths,
  paintGlobeBase,
  paintRevealOverlay,
  readGlobePalette,
  type CountryPath,
  type GlobePalette,
} from "./globeTexture";
import { PhotoBillboards, type PhotoPick } from "./photoBillboards";
import { GlobeDetail } from "./globeDetail";
import { GlobeDetailPatch } from "./detailPatch";

export interface GlobePinInput {
  id: string;
  lat: number;
  lng: number;
  /** Resolved CSS color (member color) — must be a concrete color, not a var(). */
  color: string;
}

export type GlobeTapHit =
  | PhotoPick
  | { kind: "pin"; pinId: string }
  | { kind: "surface"; lat: number; lng: number };

export interface GlobeSceneOptions {
  onTap?: (hit: GlobeTapHit) => void;
}

const GLOBE_RADIUS = 1;
const ATMOSPHERE_RADIUS = 1.048;
const MIN_DIST = 1.16; // close enough that one region fills the frame
const MAX_DIST = 3.4;
const FOV = 45;
const PHI_MIN = 0.12;
const PHI_MAX = Math.PI - 0.12;
// Same tap-vs-drag discrimination thresholds as WorldMap.
const TAP_MAX_MOVE = 6;
const TAP_MAX_DURATION = 600;
const PIN_TAP_PX = 22;
const REVEAL_MS = 1600;
const BURST_MS = 1400;
const MAX_BURSTS = 6; // a bulk import shouldn't strobe the whole planet
const IDLE_SPIN_DELAY_MS = 8000;
const IDLE_SPIN_RAD_PER_S = 0.02;
const IDLE_SPIN_MIN_DIST = 1.7; // no drifting while someone studies a region
const FLY_MS = 850;
const INERTIA_DAMPING = 3.4; // 1/s exponential decay

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface FlyAnim {
  start: number;
  fromTheta: number;
  toTheta: number;
  fromPhi: number;
  toPhi: number;
  fromDist: number;
  toDist: number;
}

interface Burst {
  group: THREE.Group;
  ring1: THREE.Mesh;
  ring2: THREE.Mesh;
  star: THREE.Sprite;
  materials: THREE.Material[];
  start: number;
}

export class GlobeScene {
  private container: HTMLElement;
  private onTap: (hit: GlobeTapHit) => void;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;

  private globeMesh: THREE.Mesh;
  private globeTexture: THREE.CanvasTexture;
  private baseCtx: CanvasRenderingContext2D;
  private baseW: number;
  private baseH: number;

  private overlayMesh: THREE.Mesh;
  private overlayMaterial: THREE.MeshBasicMaterial;
  private overlayTexture: THREE.CanvasTexture;
  private overlayCtx: CanvasRenderingContext2D;

  private atmosphereMaterial: THREE.ShaderMaterial;

  private palette: GlobePalette;
  private features: CountryFeature[] | null = null;
  private countryPaths: CountryPath[] = [];
  private visited = new Set<string>();

  private pinRoot = new THREE.Group();
  private pinMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
  private pinSealGeom: THREE.SphereGeometry;
  private pinRingGeom: THREE.RingGeometry;

  private billboards: PhotoBillboards;
  private detail: GlobeDetail;
  private detailPatch: GlobeDetailPatch;

  private burstRingGeom: THREE.RingGeometry;
  private starTexture: THREE.CanvasTexture | null = null;
  private bursts: Burst[] = [];
  private revealStart = 0;

  // Camera orbit state (globe mesh itself never rotates — lat/lng from a
  // raycast hit point needs no un-rotation that way).
  private theta = 0;
  private phi = Math.PI / 2;
  private dist = 3.0;
  private thetaVel = 0;
  private phiVel = 0;
  private fly: FlyAnim | null = null;

  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { lastX: number; lastY: number; startX: number; startY: number; moved: boolean; startTime: number; lastMoveTime: number } | null = null;
  private pinch: { startSpan: number; startDist: number } | null = null;

  private width = 1;
  private height = 1;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private frameId = 0;
  private dirty = true;
  private disposed = false;
  private contextLost = false;
  private userInteracted = false;
  private lastInteractionAt = performance.now();

  private reducedMotion: boolean;
  private motionQuery: MediaQueryList | null = null;
  private schemeQuery: MediaQueryList | null = null;
  private themeObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];

  constructor(container: HTMLElement, options: GlobeSceneOptions = {}) {
    this.container = container;
    this.onTap = options.onTap ?? (() => {});
    this.palette = readGlobePalette();

    // May throw on WebGL-less devices — GlobeMap catches and shows a message
    // (the orchestrator additionally gates on supportsWebGL() upstream).
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.canvas = this.renderer.domElement;
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "grab";
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);

    // --- atlas texture: size to device capability, capped for memory -------
    const maxTex = this.renderer.capabilities.maxTextureSize;
    const bigScreen = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2) > 1500;
    // 8k only where both the screen justifies it AND the GPU can actually
    // sample it — mobile/small screens stay at the previous 2048 to protect
    // memory. The real sharpness fix for the closest zoom is detailPatch.ts;
    // this is just a cheap across-the-board bump for big desktop displays.
    this.baseW = bigScreen && maxTex >= 8192 ? 8192 : Math.min(bigScreen ? 4096 : 2048, maxTex);
    this.baseH = this.baseW / 2;
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = this.baseW;
    baseCanvas.height = this.baseH;
    this.baseCtx = baseCanvas.getContext("2d")!;
    paintGlobeBase(this.baseCtx, this.baseW, this.baseH, [], this.visited, this.palette);

    this.globeTexture = new THREE.CanvasTexture(baseCanvas);
    this.globeTexture.colorSpace = THREE.SRGBColorSpace;
    this.globeTexture.wrapS = THREE.RepeatWrapping; // clean filtering across the ±180° seam
    // Mipmaps are on by default for CanvasTexture (generateMipmaps: true,
    // minFilter: LinearMipmapLinearFilter) — kept explicit here since they're
    // what keeps the ZOOMED-OUT globe from shimmering/aliasing; anisotropy is
    // the zoomed-IN lever, so give it the full device budget instead of the
    // old flat cap of 8.
    this.globeTexture.generateMipmaps = true;
    this.globeTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.globeTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.globeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64),
      new THREE.MeshBasicMaterial({ map: this.globeTexture }),
    );
    this.scene.add(this.globeMesh);

    // --- reveal overlay: gold flash of a fresh country, opacity-animated ---
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = this.baseW / 2;
    overlayCanvas.height = this.baseH / 2;
    this.overlayCtx = overlayCanvas.getContext("2d")!;
    this.overlayTexture = new THREE.CanvasTexture(overlayCanvas);
    this.overlayTexture.colorSpace = THREE.SRGBColorSpace;
    this.overlayTexture.wrapS = THREE.RepeatWrapping;
    this.overlayMaterial = new THREE.MeshBasicMaterial({
      map: this.overlayTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.overlayMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * 1.004, 64, 48), this.overlayMaterial);
    this.overlayMesh.visible = false;
    this.overlayMesh.renderOrder = 1;
    this.scene.add(this.overlayMesh);

    // --- atmosphere: a soft warm rim hugging the silhouette ----------------
    this.atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(this.palette.atmosphere) } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Backside shell: visible pixels lie between the globe's silhouette and
      // the shell's own; -z of the view-space normal runs ~0.29 (inner, for
      // this radius ratio) down to 0 (outer), giving a natural fade-out.
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        void main() {
          float inward = -vNormal.z;
          float rim = pow(clamp((inward - 0.015) / 0.27, 0.0, 1.0), 1.6);
          gl_FragColor = vec4(uColor, rim * 0.5);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 48, 32), this.atmosphereMaterial));

    // --- pins / photos ------------------------------------------------------
    this.pinSealGeom = new THREE.SphereGeometry(0.006, 10, 10);
    this.pinRingGeom = new THREE.RingGeometry(0.0095, 0.0125, 24);
    this.scene.add(this.pinRoot);
    this.billboards = new PhotoBillboards(this.scene, () => {
      this.dirty = true;
    });
    // Zoom-driven LOD: vector borders + sub-national detail (globeDetail.ts).
    this.detail = new GlobeDetail(this.scene, this.palette, () => {
      this.dirty = true;
    });
    // Zoom-in sharpness: repaints just the focused window at high density
    // (detailPatch.ts) once the base atlas's own texel density runs out.
    this.detailPatch = new GlobeDetailPatch(this.scene, this.palette, maxTex, () => {
      this.dirty = true;
    });

    this.burstRingGeom = new THREE.RingGeometry(0.85, 1, 40);

    this.lookAtLatLng(25, 10);

    // --- environment listeners ----------------------------------------------
    this.reducedMotion = false;
    if (typeof matchMedia !== "undefined") {
      this.motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.motionQuery.matches;
      const onMotion = () => {
        this.reducedMotion = this.motionQuery!.matches;
      };
      this.motionQuery.addEventListener("change", onMotion);
      this.cleanups.push(() => this.motionQuery!.removeEventListener("change", onMotion));

      this.schemeQuery = matchMedia("(prefers-color-scheme: dark)");
      const onScheme = () => this.refreshTheme();
      this.schemeQuery.addEventListener("change", onScheme);
      this.cleanups.push(() => this.schemeQuery!.removeEventListener("change", onScheme));
    }
    this.themeObserver = new MutationObserver(() => this.refreshTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    this.bindPointerEvents();

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frameId);
        this.frameId = 0;
      } else if (!this.disposed && this.frameId === 0) {
        this.clock.getDelta(); // swallow the hidden-time delta
        this.dirty = true;
        this.frameId = requestAnimationFrame(this.tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

    const onLost = (e: Event) => {
      e.preventDefault(); // ask the browser to attempt a restore
      this.contextLost = true;
    };
    const onRestored = () => {
      this.contextLost = false;
      this.globeTexture.needsUpdate = true;
      this.overlayTexture.needsUpdate = true;
      this.starTexture && (this.starTexture.needsUpdate = true);
      this.billboards.markTexturesDirty();
      this.detail.markTexturesDirty();
      this.detailPatch.markTexturesDirty();
      this.dirty = true;
    };
    this.canvas.addEventListener("webglcontextlost", onLost);
    this.canvas.addEventListener("webglcontextrestored", onRestored);
    this.cleanups.push(() => {
      this.canvas.removeEventListener("webglcontextlost", onLost);
      this.canvas.removeEventListener("webglcontextrestored", onRestored);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.frameId = requestAnimationFrame(this.tick);
  }

  // --- public API -----------------------------------------------------------

  setWorld(features: CountryFeature[]): void {
    this.features = features;
    this.countryPaths = buildCountryPaths(features, this.baseW, this.baseH);
    this.detail.setWorld(features);
    this.detailPatch.setWorld(this.countryPaths, this.baseW, this.baseH);
    this.repaintBase();
  }

  /**
   * Updates the fog. `revealCodes` are countries that JUST became visited —
   * they get the gold flash + burst (the caller passes [] on mount so a tab
   * switch doesn't replay every celebration, mirroring WorldMap).
   */
  setVisited(visited: ReadonlySet<string>, revealCodes: readonly string[]): void {
    this.visited = new Set(visited);
    this.repaintBase();
    if (revealCodes.length === 0 || this.reducedMotion || !this.features) return;
    paintRevealOverlay(this.overlayCtx, this.baseW, this.baseH, this.countryPaths, revealCodes, this.palette);
    this.overlayTexture.needsUpdate = true;
    this.overlayMesh.visible = true;
    this.revealStart = performance.now();
    for (const code of revealCodes.slice(0, MAX_BURSTS)) {
      const feature = this.features.find((f) => f.code === code);
      const anchor = feature && geometryAnchor(feature.geometry);
      if (anchor) this.spawnBurst(anchor.lat, anchor.lng);
    }
    this.dirty = true;
  }

  setPins(pins: readonly GlobePinInput[]): void {
    for (const child of [...this.pinRoot.children]) this.pinRoot.remove(child);
    for (const pin of pins) {
      const normal = new THREE.Vector3(...latLngToVec3(pin.lat, pin.lng, 1));
      const group = new THREE.Group();
      group.position.copy(normal).multiplyScalar(1.008);
      group.userData.pinId = pin.id;
      const seal = new THREE.Mesh(this.pinSealGeom, this.pinMaterial(this.palette.pinSeal));
      const ring = new THREE.Mesh(this.pinRingGeom, this.pinMaterial(pin.color));
      ring.lookAt(normal.clone().multiplyScalar(2)); // lie flat on the surface
      group.add(seal, ring);
      this.pinRoot.add(group);
    }
    this.dirty = true;
  }

  setPhotos(photos: readonly AlbumPhoto[], resolveUrl: (photo: AlbumPhoto) => Promise<string | null>): void {
    this.billboards.setPhotos(photos, resolveUrl);
  }

  /** Eases the camera toward a lat/lng (instant under reduced motion). */
  flyTo(lat: number, lng: number, targetDist?: number): void {
    const toDist = clamp(targetDist ?? Math.max(MIN_DIST + 0.16, this.dist * 0.55), MIN_DIST, MAX_DIST);
    const s = new THREE.Spherical().setFromVector3(new THREE.Vector3(...latLngToVec3(lat, lng, 1)));
    const toPhi = clamp(s.phi, PHI_MIN, PHI_MAX);
    if (this.reducedMotion) {
      this.theta = s.theta;
      this.phi = toPhi;
      this.dist = toDist;
      this.dirty = true;
      return;
    }
    this.thetaVel = 0;
    this.phiVel = 0;
    this.fly = {
      start: performance.now(),
      fromTheta: this.theta,
      toTheta: this.theta + shortestAngle(this.theta, s.theta),
      fromPhi: this.phi,
      toPhi,
      fromDist: this.dist,
      toDist,
    };
    this.dirty = true;
  }

  /** Instantly centers the camera on a lat/lng (initial framing). */
  lookAtLatLng(lat: number, lng: number): void {
    const s = new THREE.Spherical().setFromVector3(new THREE.Vector3(...latLngToVec3(lat, lng, 1)));
    this.theta = s.theta;
    this.phi = clamp(s.phi, PHI_MIN, PHI_MAX);
    this.dirty = true;
  }

  /** The surface point currently facing the camera — the FAB's "here". */
  getCenterLatLng(): LatLng {
    const p = this.camera.position;
    return vec3ToLatLng(p.x, p.y, p.z);
  }

  /** True when zooming further wouldn't separate a cluster any more. */
  isNearMinZoom(): boolean {
    return this.dist < MIN_DIST * 1.12;
  }

  hasUserInteracted(): boolean {
    return this.userInteracted;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.themeObserver?.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    this.billboards.dispose();
    this.detail.dispose();
    this.detailPatch.dispose();
    for (const burst of this.bursts) {
      this.scene.remove(burst.group);
      for (const m of burst.materials) m.dispose();
    }
    this.bursts = [];
    this.globeMesh.geometry.dispose();
    (this.globeMesh.material as THREE.Material).dispose();
    this.globeTexture.dispose();
    this.overlayMesh.geometry.dispose();
    this.overlayMaterial.dispose();
    this.overlayTexture.dispose();
    this.atmosphereMaterial.dispose();
    this.pinSealGeom.dispose();
    this.pinRingGeom.dispose();
    this.burstRingGeom.dispose();
    for (const material of this.pinMaterialCache.values()) material.dispose();
    this.pinMaterialCache.clear();
    this.starTexture?.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry !== this.globeMesh.geometry) obj.geometry.dispose();
    });
    this.renderer.dispose();
    this.canvas.remove();
  }

  // --- internals --------------------------------------------------------------

  private pinMaterial(color: string): THREE.MeshBasicMaterial {
    let material = this.pinMaterialCache.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide });
      this.pinMaterialCache.set(color, material);
    }
    return material;
  }

  private repaintBase(): void {
    paintGlobeBase(this.baseCtx, this.baseW, this.baseH, this.countryPaths, this.visited, this.palette);
    this.globeTexture.needsUpdate = true;
    // Keeps the patch's own visited/palette in sync and drops any stale
    // canvas — it repaints fresh (at the current window) on the next settle.
    this.detailPatch.setVisited(this.visited);
    this.dirty = true;
  }

  private refreshTheme(): void {
    this.palette = readGlobePalette();
    (this.atmosphereMaterial.uniforms.uColor.value as THREE.Color).set(this.palette.atmosphere);
    this.detail.setPalette(this.palette);
    this.detailPatch.setPalette(this.palette);
    this.repaintBase();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }

  private markInteraction(): void {
    this.userInteracted = true;
    this.lastInteractionAt = performance.now();
    this.fly = null;
  }

  // --- pointer input -----------------------------------------------------------

  private bindPointerEvents(): void {
    const canvas = this.canvas;
    const down = (e: PointerEvent) => this.onPointerDown(e);
    const move = (e: PointerEvent) => this.onPointerMove(e);
    const up = (e: PointerEvent) => this.onPointerUp(e);
    const wheel = (e: WheelEvent) => this.onWheel(e);
    const dbl = () => this.onDblClick();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", dbl);
    this.cleanups.push(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", dbl);
    });
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.markInteraction();
    this.thetaVel = 0;
    this.phiVel = 0;
    if (this.pointers.size === 1) {
      const now = performance.now();
      this.drag = { lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, startTime: now, lastMoveTime: now };
      this.pinch = null;
    } else if (this.pointers.size === 2) {
      this.drag = null;
      const pts = [...this.pointers.values()];
      this.pinch = { startSpan: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, startDist: this.dist };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastInteractionAt = performance.now();

    if (this.pointers.size >= 2 && this.pinch) {
      const pts = [...this.pointers.values()];
      const span = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      this.dist = clamp(this.pinch.startDist * (this.pinch.startSpan / span), MIN_DIST, MAX_DIST);
      this.dirty = true;
      return;
    }

    const drag = this.drag;
    if (!drag) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    // Grab-the-globe feel: rotation speed shrinks with altitude so a finger
    // roughly tracks the terrain at any zoom — up close this IS a flat map.
    const speed = ((this.dist - GLOBE_RADIUS) * 1.9) / this.height;
    const dTheta = -dx * speed;
    const dPhi = -dy * speed;
    this.theta += dTheta;
    this.phi = clamp(this.phi + dPhi, PHI_MIN, PHI_MAX);

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastMoveTime) / 1000;
    this.thetaVel = this.thetaVel * 0.7 + (dTheta / dt) * 0.3;
    this.phiVel = this.phiVel * 0.7 + (dPhi / dt) * 0.3;
    drag.lastMoveTime = now;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > TAP_MAX_MOVE) drag.moved = true;
    this.dirty = true;
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0 && this.drag) {
      const drag = this.drag;
      this.drag = null;
      const duration = performance.now() - drag.startTime;
      if (!drag.moved && duration < TAP_MAX_DURATION) {
        this.thetaVel = 0;
        this.phiVel = 0;
        this.pick(e.clientX, e.clientY);
      } else if (this.reducedMotion) {
        this.thetaVel = 0;
        this.phiVel = 0;
      }
      // else: keep the release velocity — inertia carries the spin.
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.markInteraction();
    this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
    this.dirty = true;
  }

  private onDblClick(): void {
    this.markInteraction();
    const toDist = clamp(this.dist * 0.55, MIN_DIST, MAX_DIST);
    if (this.reducedMotion) {
      this.dist = toDist;
      this.dirty = true;
      return;
    }
    this.fly = {
      start: performance.now(),
      fromTheta: this.theta,
      toTheta: this.theta,
      fromPhi: this.phi,
      toPhi: this.phi,
      fromDist: this.dist,
      toDist,
    };
  }

  // --- picking -----------------------------------------------------------------

  private pick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const sphereHits = this.raycaster.intersectObject(this.globeMesh, false);
    const sphereDist = sphereHits.length > 0 ? sphereHits[0].distance : Infinity;

    // Priority 1: photos & clusters (the scrapbook is the most precious layer).
    const photoPick = this.billboards.pick(this.raycaster, sphereDist + 0.06);
    if (photoPick) {
      this.onTap(photoPick);
      return;
    }

    // Priority 2: encounter pins — screen-space distance, because the meshes
    // themselves are only a few pixels wide.
    const pin = this.pickPin(clientX - rect.left, clientY - rect.top);
    if (pin) {
      this.onTap({ kind: "pin", pinId: pin });
      return;
    }

    // Priority 3: the ground itself.
    if (sphereHits.length > 0) {
      const p = sphereHits[0].point;
      const { lat, lng } = vec3ToLatLng(p.x, p.y, p.z);
      this.onTap({ kind: "surface", lat, lng });
    }
  }

  private pickPin(px: number, py: number): string | null {
    const camDir = this.camera.position.clone().normalize();
    const v = new THREE.Vector3();
    let best: string | null = null;
    let bestDist = PIN_TAP_PX;
    for (const group of this.pinRoot.children) {
      v.copy(group.position);
      if (v.clone().normalize().dot(camDir) < 0.2) continue; // far hemisphere
      v.project(this.camera);
      const x = ((v.x + 1) / 2) * this.width;
      const y = ((1 - v.y) / 2) * this.height;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) {
        bestDist = d;
        best = group.userData.pinId as string;
      }
    }
    return best;
  }

  // --- reveal burst ---------------------------------------------------------------

  private getStarTexture(): THREE.CanvasTexture {
    if (this.starTexture) return this.starTexture;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const c = size / 2;
    ctx.translate(c, c);
    ctx.fillStyle = this.palette.flash;
    ctx.shadowColor = this.palette.flash;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    // The map's four-point compass star, scaled to the tile.
    ctx.moveTo(0, -26);
    ctx.lineTo(5.5, -5.5);
    ctx.lineTo(26, 0);
    ctx.lineTo(5.5, 5.5);
    ctx.lineTo(0, 26);
    ctx.lineTo(-5.5, 5.5);
    ctx.lineTo(-26, 0);
    ctx.lineTo(-5.5, -5.5);
    ctx.closePath();
    ctx.fill();
    this.starTexture = new THREE.CanvasTexture(canvas);
    this.starTexture.colorSpace = THREE.SRGBColorSpace;
    return this.starTexture;
  }

  private spawnBurst(lat: number, lng: number): void {
    const normal = new THREE.Vector3(...latLngToVec3(lat, lng, 1));
    const group = new THREE.Group();
    group.position.copy(normal).multiplyScalar(1.012);

    const flash = new THREE.Color(this.palette.flash);
    const ringMat1 = new THREE.MeshBasicMaterial({ color: flash, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const ringMat2 = ringMat1.clone();
    const ring1 = new THREE.Mesh(this.burstRingGeom, ringMat1);
    const ring2 = new THREE.Mesh(this.burstRingGeom, ringMat2);
    for (const ring of [ring1, ring2]) {
      ring.lookAt(normal.clone().multiplyScalar(2));
      ring.renderOrder = 5;
    }
    const starMat = new THREE.SpriteMaterial({ map: this.getStarTexture(), transparent: true, depthTest: false });
    const star = new THREE.Sprite(starMat);
    star.renderOrder = 6;
    group.add(ring1, ring2, star);
    this.scene.add(group);
    this.bursts.push({ group, ring1, ring2, star, materials: [ringMat1, ringMat2, starMat], start: performance.now() });
  }

  private updateBursts(now: number): boolean {
    if (this.bursts.length === 0) return false;
    const alive: Burst[] = [];
    for (const burst of this.bursts) {
      const t = (now - burst.start) / BURST_MS;
      if (t >= 1) {
        this.scene.remove(burst.group);
        for (const m of burst.materials) m.dispose();
        continue;
      }
      const r1 = easeOutCubic(Math.min(1, t * 1.25));
      burst.ring1.scale.setScalar(0.02 + r1 * 0.13);
      (burst.ring1.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      const t2 = clamp((t - 0.18) / 0.82, 0, 1);
      burst.ring2.scale.setScalar(0.02 + easeOutCubic(t2) * 0.17);
      (burst.ring2.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t2);
      const pop = t < 0.3 ? easeOutCubic(t / 0.3) : 1 - (t - 0.3) / 0.7;
      burst.star.scale.setScalar(0.02 + pop * 0.075);
      (burst.star.material as THREE.SpriteMaterial).opacity = Math.max(0, pop);
      (burst.star.material as THREE.SpriteMaterial).rotation = t * 0.9;
      alive.push(burst);
    }
    this.bursts = alive;
    return true;
  }

  // --- frame loop --------------------------------------------------------------

  private tick = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.tick);
    if (this.contextLost) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now();
    let animating = false;

    if (this.fly) {
      const t = Math.min(1, (now - this.fly.start) / FLY_MS);
      const k = easeInOutCubic(t);
      this.theta = this.fly.fromTheta + (this.fly.toTheta - this.fly.fromTheta) * k;
      this.phi = this.fly.fromPhi + (this.fly.toPhi - this.fly.fromPhi) * k;
      this.dist = this.fly.fromDist + (this.fly.toDist - this.fly.fromDist) * k;
      if (t >= 1) this.fly = null;
      animating = true;
    } else if (!this.drag) {
      // Inertia after a flick (reduced motion zeroes velocities on release).
      if (Math.abs(this.thetaVel) > 0.002 || Math.abs(this.phiVel) > 0.002) {
        this.theta += this.thetaVel * dt;
        this.phi = clamp(this.phi + this.phiVel * dt, PHI_MIN, PHI_MAX);
        const decay = Math.exp(-INERTIA_DAMPING * dt);
        this.thetaVel *= decay;
        this.phiVel *= decay;
        animating = true;
      } else if (
        !this.reducedMotion &&
        this.dist > IDLE_SPIN_MIN_DIST &&
        now - this.lastInteractionAt > IDLE_SPIN_DELAY_MS
      ) {
        // The idle globe drifts gently, like a desk ornament catching light.
        this.theta += IDLE_SPIN_RAD_PER_S * dt;
        animating = true;
      }
    }

    if (this.overlayMesh.visible) {
      const t = (now - this.revealStart) / REVEAL_MS;
      if (t >= 1) {
        this.overlayMesh.visible = false;
        this.overlayMaterial.opacity = 0;
      } else {
        this.overlayMaterial.opacity = t < 0.22 ? (t / 0.22) * 0.92 : 0.92 * (1 - (t - 0.22) / 0.78);
        animating = true;
      }
      this.dirty = true;
    }
    if (this.updateBursts(now)) animating = true;

    if (!animating && !this.dirty) return; // render-on-demand: idle costs ~nothing

    this.camera.position.setFromSphericalCoords(this.dist, this.phi, this.theta);
    this.camera.lookAt(0, 0, 0);

    // Pins keep a near-constant screen size: scale ∝ distance-to-surface.
    const pinScale = clamp(this.dist - GLOBE_RADIUS, 0.14, 2.2);
    for (const group of this.pinRoot.children) group.scale.setScalar(pinScale);

    // LOD detail follows the (just-updated) camera; a fresh sub-national
    // layer's load-in fade asks for further frames via the return value.
    const detailBusy = this.detail.update(
      this.camera,
      this.dist,
      this.getCenterLatLng(),
      this.height,
      this.reducedMotion,
      now,
    );
    const patchBusy = this.detailPatch.update(this.camera, this.dist, now);

    this.billboards.update(this.camera, this.width, this.height);
    this.renderer.render(this.scene, this.camera);
    this.dirty = detailBusy || patchBusy;
  };
}

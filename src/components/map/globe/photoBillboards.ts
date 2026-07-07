// Photo billboards for the globe: each geotagged album photo becomes a little
// polaroid sprite standing on the sphere, always facing the camera. Group
// photos (arShot) get a gold frame — they're the treasure. When several
// photos crowd the same patch of screen they collapse into one stacked-
// polaroid cluster with a count badge; zooming in spreads them back out.
//
// Everything here is imperative (no hooks): image bytes are resolved through
// the non-hook resolveAlbumPhotoUrl the scene passes in, drawn onto a canvas
// polaroid, and uploaded as a sprite texture. Placeholder cards render
// immediately so the layout never pops when images stream in.

import * as THREE from "three";
import type { AlbumPhoto } from "../../../lib/types";
import { latLngToVec3, vec3ToLatLng } from "./geoSphere";

export type PhotoPick =
  | { kind: "photo"; photo: AlbumPhoto }
  | { kind: "cluster"; lat: number; lng: number; photos: AlbumPhoto[] };

// Polaroids are physical keepsakes — warm paper and real gold, deliberately
// NOT theme tokens: a photograph shouldn't recolor when the app goes dark.
const PAPER = "#fdf9f1";
const PAPER_EDGE = "rgba(92, 72, 44, 0.30)";
const PHOTO_BLANK = "#e9dfcd";
const GOLD_LIGHT = "#eccf7c";
const GOLD_DEEP = "#b9902f";
const BADGE_TEXT = "#fffaf0";
const CARD_SHADOW = "rgba(43, 31, 14, 0.35)";

const CARD_W = 132; // texture px
const CARD_H = 156;
const PHOTO_INSET = 10;
const PHOTO_SIZE = CARD_W - PHOTO_INSET * 2;
const CLUSTER_W = CARD_W + 40;
const CLUSTER_H = CARD_H + 34;

const SPRITE_PX = 56; // on-screen width of a single polaroid
const CLUSTER_PX = 68;
const CLUSTER_JOIN_PX = 46; // screen-space distance that merges photos
const SURFACE_LIFT = 1.014; // anchor just above the globe skin
const MAX_PHOTOS = 140; // texture-memory guard for prolific travellers
const RECLUSTER_MIN_MS = 160;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** One polaroid card. Draws a placeholder immediately; call again once the image arrives. */
function drawPolaroid(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, gold: boolean): void {
  const w = CARD_W;
  const h = CARD_H;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = CARD_SHADOW;
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  roundRect(ctx, 2, 2, w - 4, h - 4, 9);
  if (gold) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, GOLD_LIGHT);
    g.addColorStop(0.55, GOLD_DEEP);
    g.addColorStop(1, GOLD_LIGHT);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = PAPER;
  }
  ctx.fill();
  ctx.restore();
  roundRect(ctx, 2, 2, w - 4, h - 4, 9);
  ctx.strokeStyle = gold ? GOLD_DEEP : PAPER_EDGE;
  ctx.lineWidth = gold ? 2.5 : 1.5;
  ctx.stroke();
  if (gold) {
    // Inner paper mat so the picture still sits on polaroid white.
    roundRect(ctx, 6, 6, w - 12, h - 12, 6);
    ctx.fillStyle = PAPER;
    ctx.fill();
  }

  const px = PHOTO_INSET;
  const py = PHOTO_INSET;
  if (image) {
    // Cover-crop the photo into the square window.
    const s = Math.min(image.width, image.height);
    const sx = (image.width - s) / 2;
    const sy = (image.height - s) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, PHOTO_SIZE, PHOTO_SIZE);
    ctx.clip();
    ctx.drawImage(image, sx, sy, s, s, px, py, PHOTO_SIZE, PHOTO_SIZE);
    ctx.restore();
  } else {
    ctx.fillStyle = PHOTO_BLANK;
    ctx.fillRect(px, py, PHOTO_SIZE, PHOTO_SIZE);
  }
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, PHOTO_SIZE - 1, PHOTO_SIZE - 1);

  if (gold) {
    // "Everyone was here": three little companions dotted on the caption strip.
    const cy = py + PHOTO_SIZE + (CARD_H - py - PHOTO_SIZE - PHOTO_INSET) / 2 + 2;
    ctx.fillStyle = GOLD_DEEP;
    for (const dx of [-11, 0, 11]) {
      ctx.beginPath();
      ctx.arc(w / 2 + dx, cy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

interface Entry {
  photo: AlbumPhoto;
  anchor: THREE.Vector3; // lifted surface point
  normal: THREE.Vector3;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  image: HTMLImageElement | null;
  /** Bumped on each card redraw, so cluster caches referencing it invalidate. */
  version: number;
}

interface ClusterSprite {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  photos: AlbumPhoto[];
  lat: number;
  lng: number;
}

function makeCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

export class PhotoBillboards {
  private parent: THREE.Object3D;
  private onNeedsRender: () => void;
  private entries = new Map<string, Entry>();
  private clusters = new Map<string, ClusterSprite>();
  private clusterDirty = true;
  private lastCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lastReclusterAt = 0;
  private disposed = false;
  private projected = new THREE.Vector3();

  constructor(parent: THREE.Object3D, onNeedsRender: () => void) {
    this.parent = parent;
    this.onNeedsRender = onNeedsRender;
  }

  setPhotos(photos: readonly AlbumPhoto[], resolveUrl: (photo: AlbumPhoto) => Promise<string | null>): void {
    const keep = photos.slice(0, MAX_PHOTOS);
    const wanted = new Set(keep.map((p) => p.id));

    for (const [id, entry] of this.entries) {
      if (wanted.has(id)) continue;
      this.parent.remove(entry.sprite);
      entry.sprite.material.dispose();
      entry.texture.dispose();
      this.entries.delete(id);
    }

    for (const photo of keep) {
      if (this.entries.has(photo.id) || !photo.geo) continue;
      const normal = new THREE.Vector3(...latLngToVec3(photo.geo.lat, photo.geo.lng, 1));
      const canvas = document.createElement("canvas");
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      drawPolaroid(ctx, null, photo.arShot);
      const texture = makeCanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false }),
      );
      // Anchor near the bottom edge so the card stands up off the surface
      // like a little sign instead of sinking half-under the horizon.
      sprite.center.set(0.5, 0.12);
      sprite.position.copy(normal).multiplyScalar(SURFACE_LIFT);
      sprite.renderOrder = 3;
      sprite.userData.photoId = photo.id;
      this.parent.add(sprite);
      const entry: Entry = { photo, anchor: sprite.position.clone(), normal, canvas, ctx, texture, sprite, image: null, version: 0 };
      this.entries.set(photo.id, entry);

      void resolveUrl(photo)
        .then((url) => {
          if (!url || this.disposed || !this.entries.has(photo.id)) return null;
          const image = new Image();
          image.src = url;
          return image.decode().then(() => {
            if (this.disposed || !this.entries.has(photo.id)) return;
            entry.image = image;
            entry.version++;
            drawPolaroid(entry.ctx, image, photo.arShot);
            entry.texture.needsUpdate = true;
            this.clusterDirty = true; // clusters showing this card must redraw
            this.onNeedsRender();
          });
        })
        .catch(() => {
          // Unreachable bytes (peer offline, cleared storage) — the
          // placeholder polaroid stays, which is honest and still cozy.
        });
    }

    this.clusterDirty = true;
    this.onNeedsRender();
  }

  /**
   * Per rendered frame: keeps sprites at a constant on-screen size, and
   * re-clusters (throttled) once the camera has meaningfully moved. width/
   * height are CSS pixels of the viewport.
   */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const now = performance.now();
    const camMoved = camera.position.distanceToSquared(this.lastCamPos) > 1e-6;
    if ((this.clusterDirty || camMoved) && now - this.lastReclusterAt > RECLUSTER_MIN_MS) {
      this.recluster(camera, width, height);
      this.lastCamPos.copy(camera.position);
      this.lastReclusterAt = now;
      this.clusterDirty = false;
    }

    // Constant screen size: world-units-per-pixel at distance d for a
    // perspective camera is 2·d·tan(fov/2)/heightPx.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const scaleFor = (pos: THREE.Vector3, px: number, aspect: number, sprite: THREE.Sprite) => {
      const d = camera.position.distanceTo(pos);
      const w = (px * 2 * d * tanHalf) / Math.max(1, height);
      sprite.scale.set(w, w * aspect, 1);
    };
    for (const entry of this.entries.values()) {
      if (entry.sprite.visible) scaleFor(entry.anchor, SPRITE_PX, CARD_H / CARD_W, entry.sprite);
    }
    for (const cluster of this.clusters.values()) {
      if (cluster.sprite.visible) scaleFor(cluster.sprite.position, CLUSTER_PX, CLUSTER_H / CLUSTER_W, cluster.sprite);
    }
  }

  private recluster(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    interface Bucket {
      x: number;
      y: number;
      members: Entry[];
    }
    const buckets: Bucket[] = [];
    const camDir = camera.position.clone().normalize();

    for (const entry of this.entries.values()) {
      // Photos on the far hemisphere are hidden (depth also occludes them,
      // but skipping keeps them out of clustering and scaling entirely).
      const facing = entry.normal.dot(camDir) > 0.05;
      entry.sprite.visible = false;
      if (!facing) continue;
      this.projected.copy(entry.anchor).project(camera);
      if (this.projected.z > 1) continue;
      const x = ((this.projected.x + 1) / 2) * width;
      const y = ((1 - this.projected.y) / 2) * height;
      let placed = false;
      for (const b of buckets) {
        if (Math.hypot(b.x - x, b.y - y) < CLUSTER_JOIN_PX) {
          b.members.push(entry);
          b.x = (b.x * (b.members.length - 1) + x) / b.members.length;
          b.y = (b.y * (b.members.length - 1) + y) / b.members.length;
          placed = true;
          break;
        }
      }
      if (!placed) buckets.push({ x, y, members: [entry] });
    }

    const liveKeys = new Set<string>();
    for (const b of buckets) {
      if (b.members.length === 1) {
        b.members[0].sprite.visible = true;
        continue;
      }
      // Newest photo fronts the stack (setPhotos diffing can append out of
      // order). Cache key includes card versions so a late-arriving image
      // refreshes the stack's face.
      b.members.sort((m1, m2) => m2.photo.at - m1.photo.at);
      const key = b.members.map((m) => `${m.photo.id}.${m.version}`).join("|");
      liveKeys.add(key);
      if (!this.clusters.has(key)) this.clusters.set(key, this.buildCluster(b.members));
    }
    for (const [key, cluster] of this.clusters) {
      const live = liveKeys.has(key);
      cluster.sprite.visible = live;
      if (!live) {
        this.parent.remove(cluster.sprite);
        cluster.sprite.material.dispose();
        cluster.texture.dispose();
        this.clusters.delete(key);
      }
    }
  }

  private buildCluster(members: Entry[]): ClusterSprite {
    const canvas = document.createElement("canvas");
    canvas.width = CLUSTER_W;
    canvas.height = CLUSTER_H;
    const ctx = canvas.getContext("2d")!;
    const cx = CLUSTER_W / 2;
    const cy = CLUSTER_H / 2 + 4;

    // Two blank cards fanned behind, the newest (or best-loaded) card in front.
    const face = members.find((m) => m.image) ?? members[0];
    const back = document.createElement("canvas");
    back.width = CARD_W;
    back.height = CARD_H;
    const backCtx = back.getContext("2d")!;
    drawPolaroid(backCtx, null, false);
    for (const angle of [-0.16, 0.11]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.drawImage(back, -CARD_W / 2, -CARD_H / 2);
      ctx.restore();
    }
    ctx.drawImage(face.canvas, cx - CARD_W / 2, cy - CARD_H / 2);

    // Count badge — a little gold wax seal in the corner.
    const count = members.length;
    const bx = cx + CARD_W / 2 - 4;
    const by = cy - CARD_H / 2 + 4;
    const badge = ctx.createRadialGradient(bx - 4, by - 4, 2, bx, by, 17);
    badge.addColorStop(0, GOLD_LIGHT);
    badge.addColorStop(1, GOLD_DEEP);
    ctx.beginPath();
    ctx.arc(bx, by, 16, 0, Math.PI * 2);
    ctx.fillStyle = badge;
    ctx.fill();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = BADGE_TEXT;
    ctx.font = '700 17px system-ui, "Noto Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(count > 99 ? "99+" : String(count), bx, by + 1);

    const mean = new THREE.Vector3();
    for (const m of members) mean.add(m.normal);
    mean.normalize();
    const { lat, lng } = vec3ToLatLng(mean.x, mean.y, mean.z);

    const texture = makeCanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false }),
    );
    sprite.center.set(0.5, 0.12);
    sprite.position.copy(mean).multiplyScalar(SURFACE_LIFT + 0.004);
    sprite.renderOrder = 4;
    this.parent.add(sprite);
    return { sprite, texture, photos: members.map((m) => m.photo), lat, lng };
  }

  /** Nearest photo/cluster under the ray, ignoring anything past maxDist (the far side of the globe). */
  pick(raycaster: THREE.Raycaster, maxDist: number): PhotoPick | null {
    const targets: THREE.Object3D[] = [];
    for (const e of this.entries.values()) if (e.sprite.visible) targets.push(e.sprite);
    for (const c of this.clusters.values()) if (c.sprite.visible) targets.push(c.sprite);
    if (targets.length === 0) return null;
    const hits = raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      if (hit.distance > maxDist) break;
      for (const c of this.clusters.values()) {
        if (c.sprite === hit.object) return { kind: "cluster", lat: c.lat, lng: c.lng, photos: c.photos };
      }
      const id = hit.object.userData.photoId as string | undefined;
      if (id) {
        const entry = this.entries.get(id);
        if (entry) return { kind: "photo", photo: entry.photo };
      }
    }
    return null;
  }

  /** After a restored WebGL context every canvas texture must re-upload. */
  markTexturesDirty(): void {
    for (const e of this.entries.values()) e.texture.needsUpdate = true;
    for (const c of this.clusters.values()) c.texture.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) {
      this.parent.remove(e.sprite);
      e.sprite.material.dispose();
      e.texture.dispose();
    }
    this.entries.clear();
    for (const c of this.clusters.values()) {
      this.parent.remove(c.sprite);
      c.sprite.material.dispose();
      c.texture.dispose();
    }
    this.clusters.clear();
    // NOTE: the ObjectURLs behind the images are owned and cached by
    // memories.ts (resolveAlbumPhotoUrl) — revoking them here would poison
    // that module-level cache for every later consumer, so we deliberately
    // release only GPU resources.
  }
}

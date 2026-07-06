// Renders every OTHER room member's AR companion into the local shared
// virtual stage (scene coordinates double as the common frame — see
// docs/ar-pose-sync.md). Each remote member gets a placeholder golem the
// moment their first pose arrives, then is upgraded to their VRM once its
// bytes are fetched from mist storage. Smoothing/snap numbers are ported
// from tc-vrsns2's RemotePlayerView.

import * as THREE from "three";
import { VRMUtils } from "@pixiv/three-vrm";
import type { ArScene } from "./arScene";
import type { Companion } from "./companion";
import { createPlaceholderCompanion } from "./placeholderCompanion";
import { createVrmCompanion, loadVrmFromBytes } from "./vrmLoader";
import { ensureMistNode } from "../../lib/mistNode";
import { storage_get } from "../../vendor/mistlib/wrappers/web/index.js";
import type { CompanionPose } from "../../lib/store";

const POSITION_FOLLOW = 12;
const ROTATION_FOLLOW = 10;
const SCALE_FOLLOW = 12;
const SNAP_DISTANCE = 3;
const EXPIRY_MS = 5000;

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function shortestAngleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export interface RemoteCompanionsManager {
  /** Current room roster. Poses from ids outside it are dropped — the pose
   *  channel is unauthenticated, so an entry (a live 3D object) must only
   *  ever be allocated for a real member, never for an arbitrary id a
   *  malicious peer made up. Also prunes entries for departed members. */
  setMembers(memberIds: string[]): void;
  /** Members' vrmCid map update (triggers load/swap). */
  setVrmCids(cids: Map<string, string>): void;
  /** Apply a received pose (from onCompanionPose). */
  applyPose(pose: CompanionPose): void;
  dispose(): void;
}

interface Entry {
  root: THREE.Group;
  wrapper: Companion;
  inner: Companion;
  targetPosition: THREE.Vector3;
  targetYaw: number;
  currentYaw: number;
  targetScale: number;
  hasSynced: boolean;
  lastPoseAt: number;
  vrmCid: string | undefined;
  loadToken: number;
}

function keyFor(memberId: string): string {
  return `remote:${memberId}`;
}

export function createRemoteCompanions(scene: ArScene, ownMemberId: string): RemoteCompanionsManager {
  const entries = new Map<string, Entry>();
  let latestCids = new Map<string, string>();

  function removeEntry(memberId: string): void {
    const entry = entries.get(memberId);
    if (!entry) return;
    entries.delete(memberId);
    scene.removeCompanion(keyFor(memberId));
    entry.wrapper.dispose();
  }

  function loadVrmForEntry(memberId: string, entry: Entry, cid: string): void {
    entry.vrmCid = cid;
    const token = ++entry.loadToken;
    (async () => {
      try {
        await ensureMistNode();
        const bytes = await storage_get(cid);
        if (entry.loadToken !== token || entries.get(memberId) !== entry) return;
        const vrm = await loadVrmFromBytes(bytes);
        if (entry.loadToken !== token || entries.get(memberId) !== entry) {
          // Superseded while parsing: the scene graph is already allocated on
          // the GPU, and nothing else will ever reference it — free it here
          // or it leaks for the rest of the page session.
          VRMUtils.deepDispose(vrm.scene);
          return;
        }
        const next = createVrmCompanion(vrm);
        const prevInner = entry.inner;
        entry.root.remove(prevInner.root);
        entry.inner = next;
        entry.root.add(next.root);
        prevInner.dispose();
      } catch (err) {
        console.warn("tc-travel: failed to load remote companion VRM", err);
      }
    })();
  }

  function createEntry(memberId: string): Entry {
    const root = new THREE.Group();
    root.name = `remote-companion-${memberId}`;
    const inner = createPlaceholderCompanion();
    root.add(inner.root);

    const entry: Entry = {
      root,
      wrapper: null as unknown as Companion, // filled in immediately below
      inner,
      targetPosition: new THREE.Vector3(),
      targetYaw: 0,
      currentYaw: 0,
      targetScale: 1,
      hasSynced: false,
      lastPoseAt: performance.now(),
      vrmCid: undefined,
      loadToken: 0,
    };

    const wrapper: Companion = {
      root,
      update(deltaSeconds, elapsedSeconds) {
        if (performance.now() - entry.lastPoseAt > EXPIRY_MS) {
          removeEntry(memberId);
          return;
        }

        const posAlpha = 1 - Math.exp(-POSITION_FOLLOW * deltaSeconds);
        root.position.lerp(entry.targetPosition, posAlpha);

        const yawAlpha = 1 - Math.exp(-ROTATION_FOLLOW * deltaSeconds);
        entry.currentYaw = normalizeAngle(
          entry.currentYaw + shortestAngleDelta(entry.currentYaw, entry.targetYaw) * yawAlpha,
        );
        root.rotation.y = entry.currentYaw;

        const scaleAlpha = 1 - Math.exp(-SCALE_FOLLOW * deltaSeconds);
        root.scale.setScalar(THREE.MathUtils.lerp(root.scale.x, entry.targetScale, scaleAlpha));

        entry.inner.update(deltaSeconds, elapsedSeconds);
      },
      dispose() {
        entry.inner.dispose();
      },
    };
    entry.wrapper = wrapper;

    scene.addCompanion(keyFor(memberId), wrapper);

    const cid = latestCids.get(memberId);
    if (cid) loadVrmForEntry(memberId, entry, cid);

    return entry;
  }

  // Starts empty, so no entry is ever created before the first setMembers()
  // call delivers the real roster — see the interface note on why unknown
  // ids must never allocate anything.
  let knownMembers = new Set<string>();

  return {
    setMembers(memberIds) {
      knownMembers = new Set(memberIds);
      for (const memberId of [...entries.keys()]) {
        if (!knownMembers.has(memberId)) removeEntry(memberId);
      }
    },
    setVrmCids(cids) {
      latestCids = cids;
      for (const [memberId, cid] of cids) {
        if (memberId === ownMemberId) continue;
        const entry = entries.get(memberId);
        if (!entry || entry.vrmCid === cid) continue;
        loadVrmForEntry(memberId, entry, cid);
      }
    },
    applyPose(pose) {
      if (pose.memberId === ownMemberId) return;
      if (!knownMembers.has(pose.memberId)) return;
      let entry = entries.get(pose.memberId);
      if (!entry) {
        entry = createEntry(pose.memberId);
        entries.set(pose.memberId, entry);
      }
      entry.lastPoseAt = performance.now();
      entry.targetPosition.set(pose.x, pose.y, pose.z);
      entry.targetYaw = normalizeAngle(pose.ry);
      entry.targetScale = pose.s;

      const distance = entry.hasSynced ? entry.root.position.distanceTo(entry.targetPosition) : Infinity;
      if (!entry.hasSynced || distance > SNAP_DISTANCE) {
        entry.root.position.copy(entry.targetPosition);
        entry.currentYaw = entry.targetYaw;
        entry.root.rotation.y = entry.currentYaw;
        entry.root.scale.setScalar(entry.targetScale);
        entry.hasSynced = true;
      }
    },
    dispose() {
      for (const memberId of [...entries.keys()]) removeEntry(memberId);
    },
  };
}

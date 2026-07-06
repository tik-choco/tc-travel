// Zero-setup companion: a cute low-poly golem built from primitives, shown
// whenever the user hasn't loaded a VRM yet. Warm gold/leather palette to
// match the fantasy theme.

import * as THREE from "three";
import type { Companion } from "./companion";

const LEATHER = 0x5a3d1f;
const GOLD = 0xc9a227;
const GOLD_BRIGHT = 0xe8c547;

export function createPlaceholderCompanion(): Companion {
  const root = new THREE.Group();
  root.name = "placeholder-companion";

  const bodyMat = new THREE.MeshStandardMaterial({ color: LEATHER, roughness: 0.85, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.5, metalness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: GOLD_BRIGHT,
    emissive: GOLD_BRIGHT,
    emissiveIntensity: 0.7,
  });

  // Legs stay planted on the ground; everything above bobs gently.
  const legGeo = new THREE.CapsuleGeometry(0.09, 0.32, 4, 8);
  const legL = new THREE.Mesh(legGeo, bodyMat);
  legL.position.set(-0.13, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  root.add(legL, legR);

  const bob = new THREE.Group();
  root.add(bob);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.26), bodyMat);
  torso.position.y = 0.72;
  bob.add(torso);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.3), trimMat);
  belt.position.y = 0.49;
  bob.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), bodyMat);
  head.position.y = 1.08;
  bob.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.03, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.07, 1.1, 0.16);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.07;
  bob.add(eyeL, eyeR);

  const armGeo = new THREE.CapsuleGeometry(0.06, 0.3, 4, 8);
  const armL = new THREE.Mesh(armGeo, trimMat);
  armL.position.set(-0.26, 0.75, 0);
  armL.rotation.z = 0.15;
  const armR = armL.clone();
  armR.position.x = 0.26;
  armR.rotation.z = -0.15;
  bob.add(armL, armR);

  root.traverse((object) => {
    object.frustumCulled = false;
  });

  return {
    root,
    update(_deltaSeconds, elapsedSeconds) {
      bob.position.y = Math.sin(elapsedSeconds * 1.6) * 0.03;
      bob.rotation.y = Math.sin(elapsedSeconds * 0.8) * 0.06;
      armL.rotation.z = 0.15 + Math.sin(elapsedSeconds * 1.6 + Math.PI) * 0.05;
      armR.rotation.z = -0.15 + Math.sin(elapsedSeconds * 1.6) * 0.05;
    },
    dispose() {
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      bodyMat.dispose();
      trimMat.dispose();
      eyeMat.dispose();
    },
  };
}

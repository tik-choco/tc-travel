import type { VRM } from "@pixiv/three-vrm";

export const ARM_DOWN_ANGLE = 1.4;

export function createIdleMotion(vrm: VRM): (elapsedSeconds: number) => void {
  const humanoid = vrm.humanoid;
  if (!humanoid) return () => {};

  const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
  const leftLowerArm = humanoid.getNormalizedBoneNode("leftLowerArm");
  const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");
  const spine = humanoid.getNormalizedBoneNode("spine");
  const chest = humanoid.getNormalizedBoneNode("chest") ?? spine;
  const head = humanoid.getNormalizedBoneNode("head");

  // Normalized bone nodes always rest at an identity rotation, but the rig's
  // world-space orientation flips 180deg around Y between VRM0 and VRM1, so a
  // fixed-sign Z rotation drops the arms on one spec version and raises them
  // on the other. Derive the sign per side from the rest-pose direction the
  // lower arm extends in (its local position), falling back to the legacy
  // fixed sign when that bone is missing or sits exactly on the axis.
  const leftArmSign = leftLowerArm && leftLowerArm.position.x !== 0 ? -Math.sign(leftLowerArm.position.x) : 1;
  const rightArmSign = rightLowerArm && rightLowerArm.position.x !== 0 ? -Math.sign(rightLowerArm.position.x) : -1;

  leftUpperArm?.rotation.set(0, 0, leftArmSign * ARM_DOWN_ANGLE);
  rightUpperArm?.rotation.set(0, 0, rightArmSign * ARM_DOWN_ANGLE);

  const restChestX = chest?.rotation.x ?? 0;
  const restSpineZ = spine?.rotation.z ?? 0;
  const restHeadY = head?.rotation.y ?? 0;
  const restHeadX = head?.rotation.x ?? 0;

  return (elapsedSeconds) => {
    if (chest) chest.rotation.x = restChestX + Math.sin(elapsedSeconds * 1.4) * 0.02;
    if (spine) spine.rotation.z = restSpineZ + Math.sin(elapsedSeconds * 0.55) * 0.015;
    if (head) {
      head.rotation.y = restHeadY + Math.sin(elapsedSeconds * 0.3) * 0.05;
      head.rotation.x = restHeadX + Math.sin(elapsedSeconds * 0.45 + 1.5) * 0.025;
    }
  };
}

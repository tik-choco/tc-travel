import type { VRM } from "@pixiv/three-vrm";

export const ARM_DOWN_ANGLE = 1.4;

export function createIdleMotion(vrm: VRM): (elapsedSeconds: number) => void {
  const humanoid = vrm.humanoid;
  if (!humanoid) return () => {};

  const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
  const spine = humanoid.getNormalizedBoneNode("spine");
  const chest = humanoid.getNormalizedBoneNode("chest") ?? spine;
  const head = humanoid.getNormalizedBoneNode("head");

  leftUpperArm?.rotation.set(0, 0, ARM_DOWN_ANGLE);
  rightUpperArm?.rotation.set(0, 0, -ARM_DOWN_ANGLE);

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

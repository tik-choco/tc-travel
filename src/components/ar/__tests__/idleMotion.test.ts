import { describe, expect, it } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { ARM_DOWN_ANGLE, createIdleMotion } from "../idleMotion";

const makeBone = (x = 0, y = 0, z = 0) => ({
  rotation: {
    x,
    y,
    z,
    set(nx: number, ny: number, nz: number) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
    },
  },
});

type Bone = ReturnType<typeof makeBone>;

const makeVrm = (bones: Partial<Record<string, Bone>>) =>
  ({
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones[name] ?? null,
    },
  }) as unknown as VRM;

describe("createIdleMotion", () => {
  it("sets arms down at creation", () => {
    const leftUpperArm = makeBone();
    const rightUpperArm = makeBone();
    const vrm = makeVrm({ leftUpperArm, rightUpperArm, spine: makeBone(), chest: makeBone(), head: makeBone() });
    createIdleMotion(vrm);
    expect(leftUpperArm.rotation).toMatchObject({ x: 0, y: 0, z: ARM_DOWN_ANGLE });
    expect(rightUpperArm.rotation).toMatchObject({ x: 0, y: 0, z: -ARM_DOWN_ANGLE });
  });

  it("applies exact sway values from a zero rest pose", () => {
    const chest = makeBone();
    const spine = makeBone();
    const head = makeBone();
    const vrm = makeVrm({ leftUpperArm: makeBone(), rightUpperArm: makeBone(), spine, chest, head });
    const step = createIdleMotion(vrm);

    step(0);
    expect(chest.rotation.x).toBeCloseTo(Math.sin(0 * 1.4) * 0.02);
    expect(spine.rotation.z).toBeCloseTo(Math.sin(0 * 0.55) * 0.015);
    expect(head.rotation.y).toBeCloseTo(Math.sin(0 * 0.3) * 0.05);
    expect(head.rotation.x).toBeCloseTo(Math.sin(0 * 0.45 + 1.5) * 0.025);

    step(1.234);
    expect(chest.rotation.x).toBeCloseTo(Math.sin(1.234 * 1.4) * 0.02);
    expect(spine.rotation.z).toBeCloseTo(Math.sin(1.234 * 0.55) * 0.015);
    expect(head.rotation.y).toBeCloseTo(Math.sin(1.234 * 0.3) * 0.05);
    expect(head.rotation.x).toBeCloseTo(Math.sin(1.234 * 0.45 + 1.5) * 0.025);
  });

  it("adds sway on top of a non-zero rest rotation", () => {
    const chest = makeBone(0.1, 0, 0);
    const spine = makeBone(0, 0, 0.2);
    const head = makeBone(0.4, 0.3, 0);
    const vrm = makeVrm({ leftUpperArm: makeBone(), rightUpperArm: makeBone(), spine, chest, head });
    const step = createIdleMotion(vrm);

    step(1.234);
    expect(chest.rotation.x).toBeCloseTo(0.1 + Math.sin(1.234 * 1.4) * 0.02);
    expect(spine.rotation.z).toBeCloseTo(0.2 + Math.sin(1.234 * 0.55) * 0.015);
    expect(head.rotation.y).toBeCloseTo(0.3 + Math.sin(1.234 * 0.3) * 0.05);
    expect(head.rotation.x).toBeCloseTo(0.4 + Math.sin(1.234 * 0.45 + 1.5) * 0.025);
  });

  it("falls back to the spine node for chest sway when chest is missing", () => {
    const spine = makeBone();
    const head = makeBone();
    const vrm = makeVrm({ leftUpperArm: makeBone(), rightUpperArm: makeBone(), spine, head });
    const step = createIdleMotion(vrm);

    step(1.234);
    expect(spine.rotation.x).toBeCloseTo(Math.sin(1.234 * 1.4) * 0.02);
    expect(spine.rotation.z).toBeCloseTo(Math.sin(1.234 * 0.55) * 0.015);
  });

  it("does not throw when humanoid is missing", () => {
    const vrm = { humanoid: undefined } as unknown as VRM;
    expect(() => {
      const step = createIdleMotion(vrm);
      step(1);
    }).not.toThrow();
  });

  it("does not throw when individual bones are missing", () => {
    const vrm = makeVrm({});
    expect(() => {
      const step = createIdleMotion(vrm);
      step(0);
      step(1.234);
    }).not.toThrow();
  });
});

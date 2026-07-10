import { describe, expect, it } from "vitest";
import { clamp, clampZoom, pinchMetrics, zoomTowardPoint } from "../photoZoom";

function touch(clientX: number, clientY: number): Touch {
  return { clientX, clientY } as Touch;
}

function touchList(...touches: Touch[]): TouchList {
  const list = touches as unknown as TouchList;
  return list;
}

describe("clamp", () => {
  it("clamps a value into [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("clampZoom", () => {
  it("snaps back to identity at or below the pan-active threshold", () => {
    expect(clampZoom({ scale: 1, x: 40, y: 40 }, 300, 300)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(clampZoom({ scale: 1.02, x: 40, y: 40 }, 300, 300)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("clamps scale into [1, 5]", () => {
    expect(clampZoom({ scale: 0.4, x: 0, y: 0 }, 300, 300).scale).toBe(1);
    expect(clampZoom({ scale: 8, x: 0, y: 0 }, 300, 300).scale).toBe(5);
  });

  it("clamps pan offsets to (scale - 1) * containerSize / 2", () => {
    const result = clampZoom({ scale: 2, x: 1000, y: -1000 }, 300, 200);
    expect(result.scale).toBe(2);
    expect(result.x).toBe((2 - 1) * 300 / 2);
    expect(result.y).toBe(-((2 - 1) * 200) / 2);
  });

  it("leaves in-bounds pan offsets untouched", () => {
    const result = clampZoom({ scale: 2, x: 10, y: -10 }, 300, 200);
    expect(result).toEqual({ scale: 2, x: 10, y: -10 });
  });
});

describe("pinchMetrics", () => {
  it("returns null with fewer than two touches", () => {
    expect(pinchMetrics(touchList())).toBeNull();
    expect(pinchMetrics(touchList(touch(0, 0)))).toBeNull();
  });

  it("computes distance and midpoint between two touches", () => {
    const result = pinchMetrics(touchList(touch(0, 0), touch(30, 40)));
    expect(result).not.toBeNull();
    expect(result?.distance).toBeCloseTo(50);
    expect(result?.center).toEqual({ x: 15, y: 20 });
  });

  it("never returns a zero distance (avoids a divide-by-zero ratio)", () => {
    const result = pinchMetrics(touchList(touch(5, 5), touch(5, 5)));
    expect(result?.distance).toBe(1);
  });
});

describe("zoomTowardPoint", () => {
  const rect = { left: 0, top: 0, width: 300, height: 200 };

  it("keeps the zoomed point stationary on screen", () => {
    const start = { scale: 1, x: 0, y: 0 };
    // point offset from the rect center is (50, 50).
    const next = zoomTowardPoint(start, 2, { x: 200, y: 150 }, rect);
    expect(next).toEqual({ scale: 2, x: -50, y: -50 });
    // the image-space point under the cursor (originally at offset 50 pre-scale)
    // must still land at screen offset 50 after the new translate + scale.
    expect(next.x + 50 * next.scale).toBeCloseTo(50);
    expect(next.y + 50 * next.scale).toBeCloseTo(50);
  });

  it("resolves to identity when zooming back down to 1x", () => {
    const start = { scale: 2, x: 40, y: -20 };
    const next = zoomTowardPoint(start, 1, { x: 150, y: 100 }, rect);
    expect(next).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

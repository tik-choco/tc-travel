import { describe, expect, it } from "vitest";
import { bboxIntersectsViewport, type PaintViewport } from "../globeTexture";

// buildCountryPaths/paintGlobeBase construct a real Path2D, which this repo's
// plain-node vitest environment doesn't provide (no jsdom/happy-dom is
// configured) — so this exercises just the pure rect-intersect predicate a
// viewport-scoped repaint (detailPatch.ts) uses to skip countries nowhere
// near the focused window, without needing a canvas.

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const viewport = (x0: number, y0: number, x1: number, y1: number): PaintViewport => ({ x0, y0, x1, y1 });

describe("bboxIntersectsViewport", () => {
  it("is true when the bbox is fully inside the viewport", () => {
    expect(bboxIntersectsViewport(rect(10, 10, 20, 20), viewport(0, 0, 100, 100))).toBe(true);
  });

  it("is true for a partial overlap on either axis", () => {
    expect(bboxIntersectsViewport(rect(-10, -10, 10, 10), viewport(0, 0, 100, 100))).toBe(true);
    expect(bboxIntersectsViewport(rect(90, 90, 110, 110), viewport(0, 0, 100, 100))).toBe(true);
  });

  it("is false for a bbox clearly outside the viewport on either axis", () => {
    expect(bboxIntersectsViewport(rect(200, 10, 300, 20), viewport(0, 0, 100, 100))).toBe(false);
    expect(bboxIntersectsViewport(rect(10, 200, 20, 300), viewport(0, 0, 100, 100))).toBe(false);
  });

  it("treats touching edges as intersecting (no gap, no false negative at the seam)", () => {
    expect(bboxIntersectsViewport(rect(100, 0, 150, 100), viewport(0, 0, 100, 100))).toBe(true);
  });

  it("is symmetric — order of bbox vs viewport doesn't change adjacency semantics", () => {
    const a = rect(0, 0, 10, 10);
    const b = viewport(5, 5, 15, 15);
    expect(bboxIntersectsViewport(a, b)).toBe(bboxIntersectsViewport(b, a));
  });

  it("margin extends the test so a near-miss (e.g. a stroke's bleed) still counts", () => {
    const bbox = rect(110, 0, 120, 10); // 10px clear of a [0,100] viewport
    expect(bboxIntersectsViewport(bbox, viewport(0, 0, 100, 100))).toBe(false);
    expect(bboxIntersectsViewport(bbox, viewport(0, 0, 100, 100), 15)).toBe(true);
    expect(bboxIntersectsViewport(bbox, viewport(0, 0, 100, 100), 5)).toBe(false);
  });

  describe("antimeridian ±baseW tiling", () => {
    // A country hugging the atlas's east edge (e.g. Fiji-like, near lng=180)
    // has a bbox near x=baseW. A window centered near the seam is painted at
    // three x-offsets (-baseW/0/+baseW, see detailPatch.ts's paintPatch); the
    // country should intersect ONLY the shifted viewport that lines up with
    // it, not the raw unshifted one — that's what makes the tiling correct
    // instead of drawing every wraparound country on every pass.
    const baseW = 4096;
    const eastEdgeCountry = rect(4060, 0, 4096, 100); // hugs the east edge

    it("does not intersect the unshifted window near the seam's other side", () => {
      const seamWindow = viewport(-40, 0, 40, 100); // near wrapped lng ≈ 0
      expect(bboxIntersectsViewport(eastEdgeCountry, seamWindow)).toBe(false);
    });

    it("intersects once the window is shifted by +baseW (the wraparound tile)", () => {
      const seamWindow = viewport(-40, 0, 40, 100);
      const shifted = viewport(seamWindow.x0 + baseW, seamWindow.y0, seamWindow.x1 + baseW, seamWindow.y1);
      expect(bboxIntersectsViewport(eastEdgeCountry, shifted)).toBe(true);
    });

    it("does NOT also intersect the -baseW shift (would double-draw it)", () => {
      const seamWindow = viewport(-40, 0, 40, 100);
      const shifted = viewport(seamWindow.x0 - baseW, seamWindow.y0, seamWindow.x1 - baseW, seamWindow.y1);
      expect(bboxIntersectsViewport(eastEdgeCountry, shifted)).toBe(false);
    });
  });
});

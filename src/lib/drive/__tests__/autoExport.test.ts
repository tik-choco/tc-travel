import { describe, expect, it, vi } from "vitest";
import { cardContentKey, shouldExportCard, singleFlight } from "../autoExport";

describe("shouldExportCard", () => {
  it("skips when the recorded hash matches the fresh one", () => {
    expect(shouldExportCard("abc123", "abc123")).toBe(false);
  });

  it("re-exports when the fresh hash differs from what's recorded", () => {
    expect(shouldExportCard("abc123", "def456")).toBe(true);
  });

  it("exports when nothing has been recorded yet", () => {
    expect(shouldExportCard(undefined, "def456")).toBe(true);
  });
});

describe("cardContentKey", () => {
  const base = { id: "traveler-1", name: "Aria", avatarEmoji: "\u{1F9ED}", color: "#c9a227", message: "Safe travels!" };

  it("is stable for identical content", () => {
    expect(cardContentKey(base)).toBe(cardContentKey({ ...base }));
  });

  it("changes when the message changes", () => {
    expect(cardContentKey(base)).not.toBe(cardContentKey({ ...base, message: "New words" }));
  });

  it("changes when the color changes", () => {
    expect(cardContentKey(base)).not.toBe(cardContentKey({ ...base, color: "#123456" }));
  });

  it("changes when the name or avatar changes", () => {
    expect(cardContentKey(base)).not.toBe(cardContentKey({ ...base, name: "Mina" }));
    expect(cardContentKey(base)).not.toBe(cardContentKey({ ...base, avatarEmoji: "\u{1F5FA}\u{FE0F}" }));
  });
});

describe("singleFlight", () => {
  it("collapses calls that arrive mid-run into exactly one extra pass", async () => {
    let releaseFirst!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await gate;
    });
    const trigger = singleFlight(fn);

    const first = trigger();
    const second = trigger(); // arrives while the first pass is still pending
    const third = trigger(); // arrives while still pending — must not add a second replay

    releaseFirst();
    await Promise.all([first, second, third]);

    // One pass for the initial call, one coalesced replay for the two
    // overlapping triggers — never three.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("runs a fresh pass per call when invocations don't overlap", async () => {
    const fn = vi.fn(async () => {});
    const trigger = singleFlight(fn);
    await trigger();
    await trigger();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a trigger after a run has fully settled starts a new pass, not a replay", async () => {
    const fn = vi.fn(async () => {});
    const trigger = singleFlight(fn);
    await trigger();
    expect(fn).toHaveBeenCalledTimes(1);
    await trigger();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakLines, splitSpeechLines } from "../ai/speech";

describe("splitSpeechLines", () => {
  it("splits on both half-width !? and full-width ！？", () => {
    expect(splitSpeechLines("Hello! World?")).toEqual(["Hello!", "World?"]);
    expect(splitSpeechLines("こんにちは！元気ですか？")).toEqual(["こんにちは！", "元気ですか？"]);
  });

  it("splits on the Japanese full stop 。", () => {
    expect(splitSpeechLines("こんにちは。元気ですか?")).toEqual(["こんにちは。", "元気ですか?"]);
  });

  it("does not split on the half-width period", () => {
    expect(splitSpeechLines("e.g. this is one line.")).toEqual(["e.g. this is one line."]);
  });

  it("splits on newlines and drops resulting blank lines", () => {
    expect(splitSpeechLines("line1\nline2\n\nline3")).toEqual(["line1", "line2", "line3"]);
  });

  it("trims surrounding whitespace on each line", () => {
    expect(splitSpeechLines("  hello!   world  ")).toEqual(["hello!", "world"]);
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(splitSpeechLines("")).toEqual([]);
    expect(splitSpeechLines("   \n  ")).toEqual([]);
  });
});

// Minimal fake matching the HTMLAudioElement surface speech.ts's playBlob()
// touches: addEventListener/removeEventListener, play/pause, paused/ended.
// vitest's default node environment has no DOM, so speech.ts's `new Audio(...)`
// and `URL.createObjectURL/revokeObjectURL` calls are stubbed at the global.
class FakeAudio {
  paused = true;
  ended = false;
  src: string;
  private listeners = new Map<string, Set<() => void>>();

  constructor(src: string) {
    this.src = src;
  }
  addEventListener(type: string, cb: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  emit(type: string): void {
    this.listeners.get(type)?.forEach((cb) => cb());
  }
}

let createObjectURL: ReturnType<typeof vi.spyOn>;
let revokeObjectURL: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  let counter = 0;
  createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:fake-${counter++}`);
  revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // Node has no global Audio (browser-only); speech.ts's `new Audio(url)` needs one.
  (globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { Audio?: typeof FakeAudio }).Audio;
});

function fakeBlob(): Blob {
  return {} as Blob;
}

describe("speakLines", () => {
  it("plays lines sequentially, reporting onLineStart in order", async () => {
    const synth = vi.fn(async () => fakeBlob());
    const order: string[] = [];
    const audios: FakeAudio[] = [];
    const controller = new AbortController();

    const done = speakLines(["a", "b"], synth, controller.signal, {
      onLineStart: (line) => order.push(line),
      onAudioStart: (audio) => audios.push(audio as unknown as FakeAudio),
    });

    await vi.waitFor(() => expect(audios.length).toBe(1));
    expect(order).toEqual(["a"]);
    audios[0].emit("ended");

    await vi.waitFor(() => expect(audios.length).toBe(2));
    expect(order).toEqual(["a", "b"]);
    audios[1].emit("ended");

    await done;
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("prefetches the next line's synthesis before the current line finishes playing (one-line lookahead)", async () => {
    const synth = vi.fn(async (_line: string) => fakeBlob());
    const audios: FakeAudio[] = [];
    const controller = new AbortController();

    const done = speakLines(["a", "b", "c"], synth, controller.signal, {
      onAudioStart: (audio) => audios.push(audio as unknown as FakeAudio),
    });

    await vi.waitFor(() => expect(audios.length).toBe(1));
    // Line "b" should already be synthesizing (or synthesized) while "a" plays,
    // i.e. before its "ended" event ever fires.
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(2));

    audios[0].emit("ended");
    await vi.waitFor(() => expect(audios.length).toBe(2));
    audios[1].emit("ended");
    await vi.waitFor(() => expect(audios.length).toBe(3));
    audios[2].emit("ended");

    await done;
    expect(synth.mock.calls.map((call) => call[0])).toEqual(["a", "b", "c"]);
  });

  it("skips a line whose synthesis fails and continues with the next", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const synth = vi.fn(async (line: string) => {
      if (line === "b") throw new Error("synthesis failed");
      return fakeBlob();
    });
    const order: string[] = [];
    const audios: FakeAudio[] = [];
    const controller = new AbortController();

    const done = speakLines(["a", "b", "c"], synth, controller.signal, {
      onLineStart: (line) => order.push(line),
      onAudioStart: (audio) => audios.push(audio as unknown as FakeAudio),
    });

    await vi.waitFor(() => expect(audios.length).toBe(1));
    expect(order).toEqual(["a"]);
    audios[0].emit("ended");

    // "b" fails synthesis and is skipped without ever creating an Audio for it.
    await vi.waitFor(() => expect(audios.length).toBe(2));
    expect(order).toEqual(["a", "c"]);
    audios[1].emit("ended");

    await done;
    expect(warn).toHaveBeenCalled();
  });

  it("skips a line whose playback errors and continues with the next", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const synth = vi.fn(async () => fakeBlob());
    const order: string[] = [];
    const audios: FakeAudio[] = [];
    const controller = new AbortController();

    const done = speakLines(["a", "b"], synth, controller.signal, {
      onLineStart: (line) => order.push(line),
      onAudioStart: (audio) => audios.push(audio as unknown as FakeAudio),
    });

    await vi.waitFor(() => expect(audios.length).toBe(1));
    audios[0].emit("error");

    await vi.waitFor(() => expect(audios.length).toBe(2));
    expect(order).toEqual(["a", "b"]);
    audios[1].emit("ended");

    await done;
    expect(warn).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on abort: pauses the current line, revokes its URL, and skips the rest", async () => {
    const synth = vi.fn(async () => fakeBlob());
    const audios: FakeAudio[] = [];
    const controller = new AbortController();

    const done = speakLines(["a", "b"], synth, controller.signal, {
      onAudioStart: (audio) => audios.push(audio as unknown as FakeAudio),
    });

    await vi.waitFor(() => expect(audios.length).toBe(1));
    controller.abort();
    await done;

    expect(audios).toHaveLength(1);
    expect(audios[0].paused).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately for an empty line list", async () => {
    const synth = vi.fn(async () => fakeBlob());
    const controller = new AbortController();
    await speakLines([], synth, controller.signal);
    expect(synth).not.toHaveBeenCalled();
  });

  it("resolves immediately if already aborted before starting", async () => {
    const synth = vi.fn(async () => fakeBlob());
    const controller = new AbortController();
    controller.abort();
    await speakLines(["a"], synth, controller.signal);
    expect(synth).not.toHaveBeenCalled();
  });
});

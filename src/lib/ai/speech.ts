// Splits an LLM reply into speakable lines and plays them back sequentially
// through per-line TTS synthesis. Ported from tc-assistant2's main.tsx
// (line-split regex at L127, playAudioToEnd's object-URL cleanup discipline),
// adapted to a synthesize-then-play pipeline with one-line lookahead so the
// next line's audio is ready by the time the current one finishes.

/** Split regex ported from tc-assistant2 main.tsx:127 — splits immediately
 *  after each sentence-ending punctuation mark or newline (。, full-width
 *  ！？, half-width !?, or \n), keeping the punctuation with the line it
 *  ends. The full-width pair matters: Japanese LLM replies normally end
 *  sentences with ！／？, and without them a two-sentence reply would be
 *  synthesized as one long TTS request. */
const SPLIT_PATTERN = /(?<=[。！？!?\n])/u;

/** 「。！？!?\n」の直後で分割 → trim → 空行除去。 */
export function splitSpeechLines(text: string): string[] {
  return text
    .split(SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface SpeakCallbacks {
  onLineStart?(line: string, index: number): void;
  /** 再生を開始する HTMLAudioElement を渡す(リップシンク接続用)。行ごとに新しい要素。 */
  onAudioStart?(audio: HTMLAudioElement): void;
}

/** Plays `blob` to completion via a fresh object URL + Audio element, always
 *  revoking the URL exactly once (ended/error/abort). Resolves normally on
 *  abort (an intentional stop, not a playback failure); rejects on genuine
 *  playback errors so the caller can skip-and-continue. */
function playBlob(blob: Blob, signal: AbortSignal, callbacks?: SpeakCallbacks): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(url);
    };
    const onEnded = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("Audio playback failed."));
    };
    const onAbort = (): void => {
      cleanup();
      audio.pause();
      resolve();
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });

    callbacks?.onAudioStart?.(audio);
    audio.play().catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/** 行ごとに synthesize → 順次再生。次行の合成は再生中に先行実行(1行先読み)。
 *  1行の失敗は skip して継続。signal abort で即停止(pause + URL revoke)。 */
export async function speakLines(
  lines: string[],
  synthesize: (line: string) => Promise<Blob>,
  signal: AbortSignal,
  callbacks?: SpeakCallbacks,
): Promise<void> {
  if (lines.length === 0 || signal.aborted) return;

  let current: Promise<Blob> = synthesize(lines[0]);

  for (let i = 0; i < lines.length; i++) {
    if (signal.aborted) return;

    let blob: Blob | null = null;
    try {
      blob = await current;
    } catch (error) {
      console.warn("tc-travel: failed to synthesize speech line, skipping", error);
    }

    // Kick off the next line's synthesis now, regardless of whether this one
    // failed, so it overlaps this line's playback (one-line lookahead).
    const next = !signal.aborted && i + 1 < lines.length ? synthesize(lines[i + 1]) : null;
    // The prefetch isn't awaited until after the current line finishes
    // playing — attach a throwaway rejection handler now so an early failure
    // (e.g. the vendored TTS client rejects synchronously on over-long text)
    // doesn't surface as an unhandled rejection in the meantime. The real
    // handling still happens at the `await current` above.
    next?.catch(() => {});

    if (blob && !signal.aborted) {
      callbacks?.onLineStart?.(lines[i], i);
      try {
        await playBlob(blob, signal, callbacks);
      } catch (error) {
        console.warn("tc-travel: failed to play speech line, skipping", error);
      }
    }

    if (next) current = next;
  }
}

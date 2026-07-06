// Drives VRM mouth-open level from an <audio> element's real-time volume via
// the Web Audio API. Browser-only (AudioContext, requestAnimationFrame) — no
// tests, per the binding contract.

export interface LipSyncHandle {
  dispose(): void;
}

// One AudioContext for the whole page: browsers cap the number of contexts,
// and every speech line reuses this instead of creating/tearing one down
// per line.
let sharedContext: AudioContext | null = null;
let contextUnavailable = false;

function getAudioContext(): AudioContext | null {
  if (contextUnavailable) return null;
  if (sharedContext) return sharedContext;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) {
    contextUnavailable = true;
    return null;
  }
  try {
    sharedContext = new Ctor();
  } catch (error) {
    console.warn("tc-travel: failed to create shared AudioContext for lip sync", error);
    contextUnavailable = true;
    return null;
  }
  return sharedContext;
}

// A given HTMLMediaElement can only ever back one MediaElementAudioSourceNode
// (the Web Audio spec throws on a second createMediaElementSource call for
// the same element) — track which elements are already spoken for so a
// caller that accidentally reuses one degrades to pseudo mode instead of
// throwing. speakLines() always hands us a fresh Audio() per line, so this
// is a defensive guard rather than the expected path.
const sourcedElements = new WeakSet<HTMLAudioElement>();

const NOISE_FLOOR = 0.01;
const GAIN = 12;
const ATTACK_K = 25;
const RELEASE_K = 10;

function attachReal(ctx: AudioContext, audio: HTMLAudioElement, onLevel: (level: number) => void): LipSyncHandle {
  let source: MediaElementAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    // Must stay connected to the destination too, or routing audio through
    // the analyser silences it instead of just tapping it.
    analyser.connect(ctx.destination);
    sourcedElements.add(audio);
  } catch (error) {
    console.warn("tc-travel: failed to attach lip sync analyser, falling back to pseudo mode", error);
    return attachPseudo(audio, onLevel);
  }

  void ctx.resume().catch(() => {
    // Autoplay-policy suspension is expected until a user gesture; the
    // analyser loop below still runs (reading zeros) until it resumes.
  });

  const timeDomain = new Uint8Array(analyser.fftSize);
  let value = 0;
  let lastTime = performance.now();
  let rafId = 0;
  let disposed = false;

  const tick = (): void => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.max(0, (now - lastTime) / 1000);
    lastTime = now;

    analyser.getByteTimeDomainData(timeDomain);
    let sumSquares = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      const centered = (timeDomain[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / timeDomain.length);
    const target = Math.min(1, Math.max(0, (rms - NOISE_FLOOR) * GAIN));

    const k = target > value ? ATTACK_K : RELEASE_K;
    value += (target - value) * (1 - Math.exp(-k * dt));
    onLevel(value);

    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        // already disconnected (e.g. element GC'd) — nothing left to clean up
      }
      onLevel(0);
    },
  };
}

function attachPseudo(audio: HTMLAudioElement, onLevel: (level: number) => void): LipSyncHandle {
  const start = performance.now();
  let rafId = 0;
  let disposed = false;

  const tick = (): void => {
    if (disposed) return;
    if (!audio.paused && !audio.ended) {
      const t = (performance.now() - start) / 1000;
      onLevel(0.35 + 0.3 * Math.sin(t * 14));
    } else {
      onLevel(0);
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      onLevel(0);
    },
  };
}

/** audio 要素の実音量から口の開き(0..1)を推定して onLevel に毎フレーム通知する。
 *  AudioContext が使えない環境では擬似モード(再生中 sin 波ゆらぎ)へフォールバック。 */
export function attachLipSync(audio: HTMLAudioElement, onLevel: (level: number) => void): LipSyncHandle {
  const ctx = sourcedElements.has(audio) ? null : getAudioContext();
  if (ctx) return attachReal(ctx, audio, onLevel);
  return attachPseudo(audio, onLevel);
}

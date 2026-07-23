// Vendored consumer-side subset of @tik-choco/mistai (the shared LLM Network
// library), following the family vendor-copy principle — no runtime npm
// dependency, same as src/vendor/mistlib.
//
// Source: @tik-choco/mistai @ f3daf0ce161c3475fb624bb94012b564e11bad5a
// + provider_hello.voices backport (mistai v0.6.0, applied by hand
// 2026-07-23 — see tc-docs/drafts/tts-voice-selection-v1.md §3.4/tc-travel
// row): protocol.ts's ProviderHelloMsg.voices + decode filter only.
// Files copied verbatim from mistai/src/: protocol.ts, consumer.ts,
// voice-consumer.ts, base64.ts, errors.ts, messages.ts, id.ts.
// Intentionally NOT vendored: client.ts / node.ts (they create their own
// MistNode, which conflicts with tc-travel's one-node-per-page model — see
// src/lib/mistNode.ts), provider-side services, openai upstream client, and
// the preact UI subpath. To update, re-copy the files and bump the commit
// hash above (re-applying the voices backport if it hasn't landed in the
// base commit yet); do not hand-edit the copied files otherwise.

export * from "./errors.js";
export * from "./protocol.js";
export * from "./base64.js";
export * from "./messages.js";
export * from "./id.js";

// Named re-exports mirroring upstream index.ts: SendFn is declared in both
// consumer.ts and voice-consumer.ts, so only the consumer.ts one is exported.
export {
  ConsumerService,
  type ConsumerRequestOptions,
  type PendingRequest,
  type SendFn,
} from "./consumer.js";

export {
  VoiceConsumerService,
  REQUEST_TIMEOUT_MS,
  MAX_AUDIO_BASE64_CHARS,
  MAX_TTS_TEXT_CHARS,
  type VoiceConsumerOptions,
} from "./voice-consumer.js";

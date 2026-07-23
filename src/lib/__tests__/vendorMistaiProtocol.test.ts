// Covers the hand-applied provider_hello.voices backport in
// ../../vendor/mistai/protocol.ts (mistai v0.6.0; see
// tc-docs/drafts/tts-voice-selection-v1.md §2.1/§3.1 and the vendor header
// comment in vendor/mistai/index.ts for provenance). The vendored copy has no
// tests of its own upstream, so this file is tc-travel-local coverage for the
// decode() contract that companionClient.ts and AiSettingsPanel.tsx rely on.
import { describe, expect, it } from "vitest";
import { decode, encode, type ProviderHelloMsg } from "../../vendor/mistai";

describe("vendored mistai protocol.ts provider_hello.voices", () => {
  it("round-trips a valid voices array", () => {
    const msg: ProviderHelloMsg = { v: 1, type: "provider_hello", voices: ["alloy", "verse"] };
    const decoded = decode(encode(msg));
    expect(decoded).toEqual(msg);
  });

  it("filters non-string and empty-string entries element-wise", () => {
    const raw = JSON.stringify({
      v: 1,
      type: "provider_hello",
      voices: ["alloy", "", 42, null, "verse"],
    });
    const decoded = decode(raw) as ProviderHelloMsg;
    expect(decoded.voices).toEqual(["alloy", "verse"]);
  });

  it("drops the field entirely (not the whole message) when voices isn't an array", () => {
    const raw = JSON.stringify({ v: 1, type: "provider_hello", models: ["gpt-x"], voices: "not-an-array" });
    const decoded = decode(raw) as ProviderHelloMsg;
    expect(decoded).not.toBeNull();
    expect(decoded.models).toEqual(["gpt-x"]);
    expect(decoded.voices).toBeUndefined();
  });

  it("leaves voices undefined when the peer omits it (legacy provider)", () => {
    const decoded = decode(encode({ v: 1, type: "provider_hello" })) as ProviderHelloMsg;
    expect(decoded.voices).toBeUndefined();
  });

  it("still decodes models with the pre-existing (looser) filter, unaffected by the voices backport", () => {
    const raw = JSON.stringify({ v: 1, type: "provider_hello", models: ["gpt-x", 7, "gpt-y"] });
    const decoded = decode(raw) as ProviderHelloMsg;
    expect(decoded.models).toEqual(["gpt-x", "gpt-y"]);
  });
});

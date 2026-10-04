import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encode, EVENT_RAW, ProviderService, OaiTunnelProvider,
  roomOaiUpstream, streamChatCompletion, type ProtocolMessage,
} from "@tik-choco/mistai";
import { emptyLlmConfig } from "@tik-choco/mistai/llm-config";
import { aiRooms } from "../ai/rooms";

const transport = vi.hoisted(() => ({
  emit: undefined as undefined | ((type: number, from: string, payload: unknown, room?: string) => void),
  receive: undefined as undefined | ((msg: ProtocolMessage, room: string) => void),
  sent: [] as ProtocolMessage[],
}));
vi.mock("../mistNode", async () => {
  const { createSharedNodeScope, encode, decode, EVENT_RAW } = await import("@tik-choco/mistai");
  return { sharedMistNodeScope: createSharedNodeScope(() => ({
    async init() {},
    onEvent(handler) { transport.emit = handler; },
    joinRoom(room) {
      queueMicrotask(() => transport.emit?.(EVENT_RAW, "provider", encode({
        v: 1, type: "provider_hello", models: ["room-model"], services: ["chat", "oai"],
      }), room));
    },
    leaveRoom() {},
    sendMessage(_to, payload, _delivery, room) {
      const msg = decode(payload);
      if (msg) { transport.sent.push(msg); transport.receive?.(msg, room!); }
    },
  })) };
});

beforeEach(() => { transport.sent = []; });
afterEach(() => {
  aiRooms.disconnectRoom("team");
  transport.receive = undefined;
  vi.unstubAllGlobals();
});

describe("app room consumers on the wire", () => {
  it("sends task effort as llm_request.reasoning_effort and streams deltas through the provider", async () => {
    const fetchMock = vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"room "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n' +
      'data: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ProviderService((_to, msg) => {
      queueMicrotask(() => transport.emit?.(EVENT_RAW, "provider", encode(msg), "team"));
    }, (messages, model, onDelta, reasoningEffort) => streamChatCompletion({
      baseUrl: "https://provider.test/v1", apiKey: "provider-key", model: model!, reasoningEffort,
    }, messages, onDelta), { reasoningEffort: "medium" });
    transport.receive = msg => { provider.handleMessage("consumer", msg); };
    const onDelta = vi.fn();
    const messages = [{ role: "user" as const, content: "hi" }];

    expect(await aiRooms.requestRoomChat("team", messages, {
      model: "room-model", reasoningEffort: "high", onDelta,
    })).toBe("room answer");
    expect(transport.sent.filter(msg => msg.type === "llm_request")).toEqual([
      expect.objectContaining({ model: "room-model", messages, reasoning_effort: "high" }),
    ]);
    expect(transport.sent.some(msg => msg.type === "oai_request")).toBe(false);
    expect(onDelta.mock.calls).toEqual([["room ", "room "], ["answer", "room answer"]]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.reasoning_effort).toBe("high");
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps vision/OCR image content parts on the OpenAI tunnel", async () => {
    const config = emptyLlmConfig();
    config.providers = [{ id: "http", label: "HTTP", baseUrl: "https://provider.test/v1", apiKey: "provider-key" }];
    const tunnel = new OaiTunnelProvider((_to, msg) => {
      queueMicrotask(() => transport.emit?.(EVENT_RAW, "provider", encode(msg), "team"));
    }, roomOaiUpstream(config, [{ providerId: "http", model: "room-model" }]));
    transport.receive = msg => { tunnel.handleMessage("consumer", msg); };
    const fetchMock = vi.fn(async () => new Response('{"choices":[{"message":{"content":"recognized text"}}]}', {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const messages = [{ role: "user", content: [
      { type: "text", text: "Read the text in this image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
    ] }];

    const response = await aiRooms.requestRoomOpenAi("team", {
      path: "/chat/completions", body: JSON.stringify({ model: "room-model", messages, reasoning_effort: "low" }),
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).choices[0].message.content).toBe("recognized text");
    expect(transport.sent.some(msg => msg.type === "llm_request")).toBe(false);
    expect(transport.sent).toContainEqual(expect.objectContaining({ type: "oai_request", path: "/chat/completions" }));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "room-model", messages, reasoning_effort: "low", stream: false });
    expect(body).not.toHaveProperty("temperature");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_CONFIG_KEY } from "@tik-choco/mistai/llm-config";
import { AI_SETTINGS_KEY } from "../ai/aiSettings";
import { CompanionClient } from "../ai/companionClient";
import { aiRooms } from "../ai/rooms";
vi.mock("../ai/rooms", () => ({ aiRooms: { requestRoomChat: vi.fn(), requestRoomOpenAi: vi.fn(), requestRoomTts: vi.fn() } }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify({ v: 1, providers: [
    { id: "a", label: "A", baseUrl: "https://a.test/v1", apiKey: "key-a" },
    { id: "b", label: "B", baseUrl: "https://b.test/v1", apiKey: "key-b" },
    { id: "room1", label: "Room 1", baseUrl: "mist-network://first", apiKey: "" },
    { id: "room2", label: "Room 2", baseUrl: "mist-network://second", apiKey: "" },
  ], presets: [], defaultPresetId: "", defaultModel: { providerId: "a", model: "same-id" }, network: { roomId: "" }, updatedAt: "old" }));
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ modelsMigrated: true, tasks: {
    orchestrator: { ref: { providerId: "a", model: "same-id" }, reasoningEffort: "high" },
    worker: { ref: { providerId: "b", model: "same-id" }, reasoningEffort: "none" },
  }, roomProvide: {}, recentModels: [] }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("task and voice requests", () => {
  it("uses shared HTTP TTS speed, caller hints and the actual response MIME", async () => {
    const config = JSON.parse(localStorage.getItem(LLM_CONFIG_KEY)!);
    config.tts = { providerId: "a", model: "speech", voice: "saved", speed: 1.5 };
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("audio", { headers: { "Content-Type": "audio/ogg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CompanionClient();
    expect((await client.requestTts({ text: "hello" })).type).toBe("audio/ogg");
    await client.requestTts({ text: "hello", speed: 0.75, responseFormat: "wav" });
    await client.requestTts({ text: "hello", speed: 5, responseFormat: "unknown" });
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(call[1]!.body as string));
    expect(bodies[0].speed).toBe(1.5); expect(bodies[0]).not.toHaveProperty("response_format");
    expect(bodies[1]).toMatchObject({ speed: 0.75, response_format: "wav" });
    expect(bodies[2]).not.toHaveProperty("speed"); expect(bodies[2]).not.toHaveProperty("response_format");
  });
  it("forwards explicit room TTS hints without replacing the response MIME", async () => {
    const config = JSON.parse(localStorage.getItem(LLM_CONFIG_KEY)!);
    config.tts = { providerId: "room2", model: "network-auto", speed: 1.5 };
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
    vi.mocked(aiRooms.requestRoomTts).mockResolvedValue(new Blob(["audio"], { type: "audio/ogg" }));
    expect((await new CompanionClient().requestTts({ text: "hello", speed: 0.75, responseFormat: "wav" })).type).toBe("audio/ogg");
    expect(aiRooms.requestRoomTts).toHaveBeenCalledWith("second", { text: "hello", model: undefined, voice: undefined, speed: 0.75, responseFormat: "wav" });
  });
  it("routes identical model IDs to the selected provider, passes per-task effort and omits temperature", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CompanionClient();
    await client.requestChat([{ role: "user", content: "hi" }], { task: "orchestrator" });
    await client.requestChat([{ role: "user", content: "hi" }], { task: "worker" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://a.test/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://b.test/v1/chat/completions");
    const bodies = fetchMock.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
    expect(bodies.map(b => b.reasoning_effort)).toEqual(["high", "none"]);
    bodies.forEach(body => expect(body).not.toHaveProperty("temperature"));
  });
  it("routes each task to its own room with reasoning and streaming deltas", async () => {
    const local = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY)!);
    local.tasks.orchestrator.ref.providerId = "room1";
    local.tasks.worker.ref.providerId = "room2";
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(local));
    vi.mocked(aiRooms.requestRoomChat).mockImplementation(async (_room, _messages, options) => {
      if (typeof options === "object") {
        options.onDelta?.("room ", "room ");
        options.onDelta?.("answer", "room answer");
      }
      return "room answer";
    });
    const client = new CompanionClient();
    const messages = [{ role: "user" as const, content: "hi" }];
    const onDelta = vi.fn();
    expect(await client.requestChat(messages, { task: "orchestrator" })).toBe("room answer");
    expect(await client.requestChat(messages, { task: "worker", onDelta })).toBe("room answer");
    expect(aiRooms.requestRoomChat).toHaveBeenNthCalledWith(1, "first", messages, {
      model: "same-id", reasoningEffort: "high", onDelta: undefined,
    });
    expect(aiRooms.requestRoomChat).toHaveBeenNthCalledWith(2, "second", messages, {
      model: "same-id", reasoningEffort: "none", onDelta,
    });
    expect(onDelta.mock.calls).toEqual([["room ", "room "], ["answer", "room answer"]]);
    expect(aiRooms.requestRoomOpenAi).not.toHaveBeenCalled();
  });
  it("uses the configured TTS provider and strips the room auto sentinel", async () => {
    const config = JSON.parse(localStorage.getItem(LLM_CONFIG_KEY)!);
    config.tts = { providerId: "room2", model: "network-auto", voice: "voice-id" };
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
    vi.mocked(aiRooms.requestRoomTts).mockResolvedValue(new Blob());
    await new CompanionClient().requestTts({ text: "hello" });
    expect(aiRooms.requestRoomTts).toHaveBeenCalledWith("second", { text: "hello", model: undefined, voice: "voice-id" });
  });
});

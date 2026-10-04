import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LLM_CONFIG_KEY, loadLlmConfig, migrateSharedLlmConfig, type SharedLlmConfigV1 } from "@tik-choco/mistai/llm-config";
import { AI_SETTINGS_KEY, loadAiSettings, resolveTaskTarget, saveAiSettings, isAiConfigured } from "../ai/aiSettings";
import { AI_MESSAGES } from "../../components/guild/aiMessages";

export function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}
beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());
const legacy = (): SharedLlmConfigV1 => ({ v: 1, updatedAt: "old", providers: [
  { id: "http", label: "Endpoint", baseUrl: "https://endpoint.test/v1", apiKey: "", models: Array.from({ length: 300 }, (_, i) => `model-${i}`) },
  { id: "disabled", label: "Disabled", baseUrl: "https://disabled.test/v1", apiKey: "", enabled: false },
], presets: [
  { id: "plan", label: "Plan", providerId: "http", model: "model-1", reasoningEffort: "high", temperature: 0.7 },
  { id: "reply", label: "Reply", providerId: "disabled", model: "model-2" },
], defaultPresetId: "plan", network: { roomId: "legacy-room" } });

describe("AI reference migration", () => {
  it("migrates once, keeps legacy shared data, cache and effort, and leaves cleared refs cleared", () => {
    const original = legacy();
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(original));
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ tasks: { orchestrator: { presetId: "plan" }, worker: { presetId: "reply", reasoningEffort: "low" } }, networkProviderEnabled: true, networkSharedPresetIds: ["plan"] }));
    const first = loadAiSettings();
    expect(first.tasks.orchestrator).toEqual({ ref: { providerId: "http", model: "model-1" }, reasoningEffort: "high" });
    expect(first.tasks.worker).toEqual({ ref: { providerId: "disabled", model: "model-2" }, reasoningEffort: "low" });
    const config = loadLlmConfig()!;
    expect(config.defaultModel).toEqual(first.tasks.orchestrator.ref);
    expect(config.presets).toEqual(original.presets);
    expect(config.network).toEqual(original.network);
    expect(config.defaultPresetId).toBe(original.defaultPresetId);
    expect(config.providers[0].models).toHaveLength(300);
    const room = config.providers.find(p => p.baseUrl === "mist-network://legacy-room")!;
    expect(first.roomProvide[room.id]).toEqual({ enabled: true, shared: [first.tasks.orchestrator.ref] });
    expect(migrateSharedLlmConfig(config).changed).toBe(false);
    const serialized = localStorage.getItem(AI_SETTINGS_KEY);
    loadAiSettings();
    expect(localStorage.getItem(AI_SETTINGS_KEY)).toBe(serialized);
    expect(resolveTaskTarget("worker", first)).toMatchObject({ providerId: "http", model: "model-1", reasoningEffort: "low" });
    expect(first.tasks.worker.ref?.providerId).toBe("disabled");
    first.tasks.orchestrator.ref = undefined;
    saveAiSettings(first);
    expect(loadAiSettings().tasks.orchestrator.ref).toBeUndefined();
  });
  it("uses only a usable default and never selects the first cached provider", () => {
    const config = legacy(); config.defaultPresetId = "missing";
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
    expect(resolveTaskTarget("worker")).toBeNull();
    expect(isAiConfigured()).toBe(false);
  });
  it("handles corrupt local storage", () => {
    localStorage.setItem(AI_SETTINGS_KEY, "{");
    expect(loadAiSettings().tasks.worker).toEqual({ reasoningEffort: "none" });
  });
  it("keeps a local room override while migrating sharing into the legacy shared room", () => {
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(legacy()));
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ roomId: "local-room", model: "custom-model", voice: "custom-voice", networkProviderEnabled: true, networkProviderPresetIds: ["plan"] }));
    const local = loadAiSettings();
    const config = loadLlmConfig()!;
    const sharedRoom = config.providers.find(p => p.baseUrl === "mist-network://legacy-room")!;
    const overrideRoom = config.providers.find(p => p.baseUrl === "mist-network://local-room")!;
    expect(local.roomProvide[sharedRoom.id].enabled).toBe(true);
    expect(local.roomProvide[sharedRoom.id].shared).toEqual([{ providerId: "http", model: "model-1" }]);
    expect(local.tasks.worker.ref).toEqual({ providerId: overrideRoom.id, model: "custom-model" });
    expect(config.tts).toEqual({ providerId: overrideRoom.id, model: "network-auto", voice: "custom-voice" });
    expect(config.network.roomId).toBe("legacy-room");
    const snapshot = localStorage.getItem(LLM_CONFIG_KEY);
    loadAiSettings();
    expect(localStorage.getItem(LLM_CONFIG_KEY)).toBe(snapshot);
  });
});

describe("AI app locale completeness", () => {
  it("has identical nonempty keys and placeholders in en/ja/zh-CN/zh-TW", () => {
    for (const catalog of Object.values(AI_MESSAGES)) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(AI_MESSAGES.en).sort());
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim()).not.toBe("");
        expect(value.match(/\{[^}]+\}/g) ?? []).toEqual(AI_MESSAGES.en[key as keyof typeof AI_MESSAGES.en].match(/\{[^}]+\}/g) ?? []);
      }
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_SETTINGS_KEY,
  isAiConfigured,
  loadAiSettings,
  resolveTaskModel,
  saveAiSettings,
  type AiCompanionSettings,
} from "../ai/aiSettings";
import { LLM_CONFIG_KEY, type SharedLlmConfigV1 } from "../drive/llmConfig";

// vitest's default environment is node (no DOM, no localStorage) — stub a
// minimal in-memory Storage so aiSettings.ts's localStorage calls resolve
// the same way they would in a browser.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const EMPTY_TASKS = { orchestrator: { presetId: "" }, worker: { presetId: "" } };

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

describe("loadAiSettings", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadAiSettings()).toEqual({ roomId: "", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(AI_SETTINGS_KEY, "{not valid json");
    expect(loadAiSettings()).toEqual({ roomId: "", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("falls back to defaults when the stored value isn't an object", () => {
    localStorage.setItem(AI_SETTINGS_KEY, "42");
    expect(loadAiSettings()).toEqual({ roomId: "", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("fills in defaults for missing/malformed individual fields", () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ roomId: "room-1", model: 42, ttsEnabled: "yes" }));
    expect(loadAiSettings()).toEqual({ roomId: "room-1", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("fills in defaults when tasks is missing (legacy stored settings)", () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ roomId: "room-1", ttsEnabled: true }));
    expect(loadAiSettings()).toEqual({ roomId: "room-1", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("sanitizes a corrupted tasks shape (not an object)", () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ roomId: "room-1", ttsEnabled: true, tasks: "nope" }));
    expect(loadAiSettings()).toEqual({ roomId: "room-1", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("sanitizes corrupted per-role task entries and coerces non-string fields to empty strings", () => {
    localStorage.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({
        roomId: "room-1",
        ttsEnabled: true,
        tasks: {
          orchestrator: { presetId: 42 },
          worker: null,
        },
      }),
    );
    expect(loadAiSettings()).toEqual({
      roomId: "room-1",
      ttsEnabled: true,
      tasks: {
        orchestrator: { presetId: "" },
        worker: { presetId: "" },
      },
    });
  });
});

describe("saveAiSettings / loadAiSettings roundtrip", () => {
  it("persists and reloads a full settings object", () => {
    const settings: AiCompanionSettings = {
      roomId: "room-42",
      model: "gpt-x",
      voice: "narrator",
      persona: "A cheerful guide.",
      ttsEnabled: false,
      tasks: EMPTY_TASKS,
    };
    saveAiSettings(settings);
    expect(loadAiSettings()).toEqual(settings);
  });

  it("omits optional fields entirely when absent, rather than storing them as undefined", () => {
    saveAiSettings({ roomId: "room-1", ttsEnabled: true, tasks: EMPTY_TASKS });
    expect(loadAiSettings()).toEqual({ roomId: "room-1", ttsEnabled: true, tasks: EMPTY_TASKS });
  });

  it("persists and reloads task preset assignments", () => {
    const settings: AiCompanionSettings = {
      roomId: "room-1",
      ttsEnabled: true,
      tasks: {
        orchestrator: { presetId: "preset-a" },
        worker: { presetId: "preset-b" },
      },
    };
    saveAiSettings(settings);
    expect(loadAiSettings()).toEqual(settings);
  });

  it("swallows localStorage write failures with a console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveAiSettings({ roomId: "x", ttsEnabled: true, tasks: EMPTY_TASKS })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("isAiConfigured", () => {
  it("is false for an empty or whitespace-only roomId", () => {
    expect(isAiConfigured({ roomId: "", ttsEnabled: true, tasks: EMPTY_TASKS })).toBe(false);
    expect(isAiConfigured({ roomId: "   ", ttsEnabled: true, tasks: EMPTY_TASKS })).toBe(false);
  });

  it("is true once roomId is set", () => {
    expect(isAiConfigured({ roomId: "room-1", ttsEnabled: true, tasks: EMPTY_TASKS })).toBe(true);
  });

  it("reads from storage when called without an argument", () => {
    expect(isAiConfigured()).toBe(false);
    saveAiSettings({ roomId: "room-9", ttsEnabled: true, tasks: EMPTY_TASKS });
    expect(isAiConfigured()).toBe(true);
  });
});

function saveSharedLlmConfig(config: SharedLlmConfigV1): void {
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
}

function baseSharedConfig(): SharedLlmConfigV1 {
  return {
    v: 1,
    providers: [{ id: "prov-1", label: "Provider", baseUrl: "https://example.test", apiKey: "key" }],
    presets: [
      { id: "preset-orchestrator", label: "Orchestrator preset", providerId: "prov-1", model: "claude-opus-5" },
      { id: "preset-worker", label: "Worker preset", providerId: "prov-1", model: "claude-haiku-5" },
    ],
    defaultPresetId: "preset-worker",
    network: { roomId: "" },
    updatedAt: "",
  };
}

describe("resolveTaskModel", () => {
  it("returns an empty string when nothing is configured (no hardcoded vendor fallback)", () => {
    expect(resolveTaskModel("orchestrator", { roomId: "", ttsEnabled: true, tasks: EMPTY_TASKS })).toBe("");
    expect(resolveTaskModel("worker", { roomId: "", ttsEnabled: true, tasks: EMPTY_TASKS })).toBe("");
  });

  it("falls back to the legacy settings.model when set", () => {
    const settings: AiCompanionSettings = {
      roomId: "",
      model: "legacy-model",
      ttsEnabled: true,
      tasks: EMPTY_TASKS,
    };
    expect(resolveTaskModel("orchestrator", settings)).toBe("legacy-model");
  });

  it("prefers a resolvable presetId over the legacy settings.model", () => {
    saveSharedLlmConfig(baseSharedConfig());
    const settings: AiCompanionSettings = {
      roomId: "",
      model: "legacy-model",
      ttsEnabled: true,
      tasks: {
        orchestrator: { presetId: "preset-orchestrator" },
        worker: { presetId: "" },
      },
    };
    expect(resolveTaskModel("orchestrator", settings)).toBe("claude-opus-5");
    expect(resolveTaskModel("worker", settings)).toBe("legacy-model");
  });

  it("falls through to the legacy model when the presetId doesn't resolve to itself", () => {
    saveSharedLlmConfig(baseSharedConfig());
    const settings: AiCompanionSettings = {
      roomId: "",
      model: "legacy-model",
      ttsEnabled: true,
      tasks: {
        orchestrator: { presetId: "does-not-exist" },
        worker: { presetId: "" },
      },
    };
    // resolvePreset() falls back to config.defaultPresetId for an unknown
    // presetId; resolveTaskModel must detect that mismatch and treat the
    // preset as unresolved rather than silently using the default preset.
    expect(resolveTaskModel("orchestrator", settings)).toBe("legacy-model");
  });

  it("falls through to the shared config's default preset when no task/legacy override is set", () => {
    saveSharedLlmConfig(baseSharedConfig());
    const settings: AiCompanionSettings = {
      roomId: "",
      ttsEnabled: true,
      tasks: EMPTY_TASKS,
    };
    // baseSharedConfig()'s defaultPresetId is "preset-worker".
    expect(resolveTaskModel("orchestrator", settings)).toBe("claude-haiku-5");
    expect(resolveTaskModel("worker", settings)).toBe("claude-haiku-5");
  });

  it("returns an empty string when a presetId is set but no shared config exists", () => {
    const settings: AiCompanionSettings = {
      roomId: "",
      ttsEnabled: true,
      tasks: {
        orchestrator: { presetId: "preset-orchestrator" },
        worker: { presetId: "" },
      },
    };
    expect(resolveTaskModel("orchestrator", settings)).toBe("");
  });

  it("loads settings from storage when called without an argument", () => {
    saveSharedLlmConfig(baseSharedConfig());
    saveAiSettings({
      roomId: "",
      ttsEnabled: true,
      tasks: {
        orchestrator: { presetId: "preset-orchestrator" },
        worker: { presetId: "preset-worker" },
      },
    });
    expect(resolveTaskModel("orchestrator")).toBe("claude-opus-5");
    expect(resolveTaskModel("worker")).toBe("claude-haiku-5");
  });
});

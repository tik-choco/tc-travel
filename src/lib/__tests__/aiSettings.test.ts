import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_SETTINGS_KEY, isAiConfigured, loadAiSettings, saveAiSettings, type AiCompanionSettings } from "../ai/aiSettings";

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

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

describe("loadAiSettings", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadAiSettings()).toEqual({ roomId: "", ttsEnabled: true });
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(AI_SETTINGS_KEY, "{not valid json");
    expect(loadAiSettings()).toEqual({ roomId: "", ttsEnabled: true });
  });

  it("falls back to defaults when the stored value isn't an object", () => {
    localStorage.setItem(AI_SETTINGS_KEY, "42");
    expect(loadAiSettings()).toEqual({ roomId: "", ttsEnabled: true });
  });

  it("fills in defaults for missing/malformed individual fields", () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ roomId: "room-1", model: 42, ttsEnabled: "yes" }));
    expect(loadAiSettings()).toEqual({ roomId: "room-1", ttsEnabled: true });
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
    };
    saveAiSettings(settings);
    expect(loadAiSettings()).toEqual(settings);
  });

  it("omits optional fields entirely when absent, rather than storing them as undefined", () => {
    saveAiSettings({ roomId: "room-1", ttsEnabled: true });
    expect(loadAiSettings()).toEqual({ roomId: "room-1", ttsEnabled: true });
  });

  it("swallows localStorage write failures with a console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveAiSettings({ roomId: "x", ttsEnabled: true })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("isAiConfigured", () => {
  it("is false for an empty or whitespace-only roomId", () => {
    expect(isAiConfigured({ roomId: "", ttsEnabled: true })).toBe(false);
    expect(isAiConfigured({ roomId: "   ", ttsEnabled: true })).toBe(false);
  });

  it("is true once roomId is set", () => {
    expect(isAiConfigured({ roomId: "room-1", ttsEnabled: true })).toBe(true);
  });

  it("reads from storage when called without an argument", () => {
    expect(isAiConfigured()).toBe(false);
    saveAiSettings({ roomId: "room-9", ttsEnabled: true });
    expect(isAiConfigured()).toBe(true);
  });
});

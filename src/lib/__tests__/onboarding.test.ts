import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// personal.ts caches the loaded profile in a module-level variable, so each
// test needs a genuinely fresh module graph (not just a fresh localStorage)
// to see its own seeded state — hence vi.resetModules() + a dynamic import
// per test, the same pattern geo/__tests__/municipalResolver.test.ts uses.

/** Minimal in-memory localStorage stand-in for the node test environment. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shouldShowOnboarding", () => {
  it("is true on a genuinely fresh install", async () => {
    const { shouldShowOnboarding, isOnboardingDone } = await import("../onboarding");
    expect(shouldShowOnboarding()).toBe(true);
    // Merely asking doesn't mark it done — only markOnboardingDone()/an
    // existing-user signal does.
    expect(isOnboardingDone()).toBe(false);
  });

  it("is false, and silently marks done, when local memories already exist", async () => {
    localStorage.setItem("tc-travel:solo:pins", JSON.stringify([{ id: "p1" }]));
    const { shouldShowOnboarding, isOnboardingDone } = await import("../onboarding");
    expect(shouldShowOnboarding()).toBe(false);
    expect(isOnboardingDone()).toBe(true);
  });

  it("is false when a party has already been joined", async () => {
    localStorage.setItem(
      "tc-travel:joinedRooms",
      JSON.stringify([{ roomId: "r1", name: "Party", lastOpened: Date.now() }]),
    );
    const { shouldShowOnboarding } = await import("../onboarding");
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("is false when the profile name was already personalized", async () => {
    localStorage.setItem(
      "tc-travel:profile",
      JSON.stringify({
        id: "u1",
        name: "Sir Reginald",
        color: "#c9a227",
        avatarEmoji: "🧭",
        language: "auto",
        theme: "light",
      }),
    );
    const { shouldShowOnboarding } = await import("../onboarding");
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("stays false once marked done, even for an otherwise-fresh install", async () => {
    localStorage.setItem("tc-travel:onboarding-done", "1");
    const { shouldShowOnboarding } = await import("../onboarding");
    expect(shouldShowOnboarding()).toBe(false);
  });
});

describe("onboarding re-open requests", () => {
  it("notifies subscribers and stops after unsubscribe", async () => {
    const { subscribeOnboardingRequests, requestOnboarding } = await import("../onboarding");
    const spy = vi.fn();
    const unsub = subscribeOnboardingRequests(spy);

    requestOnboarding();
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    requestOnboarding();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

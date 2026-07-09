// First-run onboarding state — a single "completed" flag in localStorage plus
// a tiny same-tab request channel so the Guild settings screen can ask the
// app shell to re-open the wizard (the overlay lives in app.tsx, above all
// screens — mirrors tc-town's src/lib/onboarding.ts).
import { hasLocalMemories } from "./local/localMemories";
import { DEFAULT_PROFILE_NAME, getProfile, joinedRoomCount } from "./personal";

const DONE_KEY = "tc-travel:onboarding-done";

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    // Storage unavailable — treat as done so the wizard can't loop forever.
    return true;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Non-fatal; worst case the wizard shows again next launch.
  }
}

/**
 * Whether the wizard should open on launch: only on a genuinely fresh
 * install. A traveller who already has recorded memories, has joined a
 * party, or has already personalized their name (i.e. someone from before
 * onboarding shipped) is marked done silently so they're never interrupted.
 */
export function shouldShowOnboarding(): boolean {
  if (isOnboardingDone()) return false;
  if (hasLocalMemories() || joinedRoomCount() > 0 || getProfile().name !== DEFAULT_PROFILE_NAME) {
    markOnboardingDone();
    return false;
  }
  return true;
}

// --- Re-open requests (Guild settings -> app shell) --------------------------

const listeners = new Set<() => void>();

/** App shell subscribes once; returns an unsubscribe fn. */
export function subscribeOnboardingRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Asks the app shell to open the onboarding wizard (e.g. from Guild settings). */
export function requestOnboarding(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn("tc-travel: onboarding listener threw", error);
    }
  }
}

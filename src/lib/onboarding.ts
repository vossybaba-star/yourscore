import { isNative } from "./native";

// First-run + push pre-prompt flags for the native app. Synchronous,
// localStorage-backed, and guarded so they are pure no-ops on web (where
// MarketingLanding is the intended logged-out experience). Every storage access
// is wrapped — a throw (Safari private mode / WebView quirks) fails *closed*
// ("already seen") so a storage error can never trap a user in an onboarding loop.
//
// The `:v1` suffix lets a future redesigned flow re-trigger onboarding for
// everyone by bumping the key, with no migration.

const ONBOARDED_KEY = "yourscore:onboarding:v1";
const PUSH_PROMPTED_KEY = "yourscore:push-prompted:v1";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return true; // fail closed
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // ignore — worst case the screen shows once more
  }
}

export function hasSeenOnboarding(): boolean {
  if (!isNative()) return true; // web never onboards
  return readFlag(ONBOARDED_KEY);
}

export function markOnboardingSeen(): void {
  if (!isNative()) return;
  writeFlag(ONBOARDED_KEY);
}

export function hasPromptedPush(): boolean {
  if (!isNative()) return true;
  return readFlag(PUSH_PROMPTED_KEY);
}

export function markPushPrompted(): void {
  if (!isNative()) return;
  writeFlag(PUSH_PROMPTED_KEY);
}

// QA helper — clears both flags so the flow can be replayed on-device. Wired to
// window.__resetOnboarding in non-production builds (see NativeOnboarding).
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(ONBOARDED_KEY);
    localStorage.removeItem(PUSH_PROMPTED_KEY);
  } catch {
    // ignore
  }
}

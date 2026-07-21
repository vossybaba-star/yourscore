// First-launch onboarding-tour flags — synchronous and localStorage-backed.
// Every storage access is wrapped; the seen-flag fails *closed* ("already
// seen") so a storage error can never trap a user in a tour loop, while the
// fresh-install stamp fails closed the OTHER way (not fresh) so a storage
// error can never show the tour to an existing customer.
//
// The `:v1` suffix lets a future rewritten tour re-trigger for everyone by
// bumping the key, with no migration (same convention as onboarding.ts).

import { isNative } from "./native";

export type TipId = "app-tour";

// Accounts created before this instant NEVER see the tour — it is for new
// users going forward, not current customers (founder, 2026-07-21). Set to
// the earliest day the feature can be on prod; move it forward if the merge
// slips past it, never backward.
export const TOUR_EPOCH_ISO = "2026-07-22T00:00:00Z";

// Written at module load on a native device where the first-run carousel flag
// is absent — which is exactly "this install has never opened the app before"
// (every existing install marked yourscore:onboarding:v1 on its first run,
// and module evaluation runs before NativeOnboarding can mark it in this
// session). Persisted so the signal survives into later sessions if the tour
// doesn't get to run on the very first open.
const FRESH_INSTALL_KEY = "ys:tip:fresh-install:v1";
// NativeOnboarding's key, read-only here — never write it from this module.
const NATIVE_ONBOARDED_KEY = "yourscore:onboarding:v1";

function tipKey(id: TipId): string {
  return `ys:tip:${id}:v1`;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return true; // fail closed: reads as "seen"
  }
}

// For gates that must default to NOT showing UI on storage failure.
function readFlagStrict(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // ignore — worst case the tour shows once more
  }
}

// Module-load side effect (client bundle only): stamp fresh installs.
try {
  if (typeof window !== "undefined" && isNative() && localStorage.getItem(NATIVE_ONBOARDED_KEY) !== "1") {
    localStorage.setItem(FRESH_INSTALL_KEY, "1");
  }
} catch {
  // no stamp → guest tour never fires on this device; safe default
}

export function hasSeenTip(id: TipId): boolean {
  return readFlag(tipKey(id));
}

export function markTipSeen(id: TipId): void {
  writeFlag(tipKey(id));
}

/**
 * Who gets the tour (QA `?tour=1` override lives in SpotlightTour, not here):
 *
 * - Signed in → only accounts created at/after TOUR_EPOCH. Current customers
 *   never qualify, regardless of account age. Missing/unparseable created_at
 *   fails closed (no tour).
 * - Guest → only a fresh native install (stamped above), and only once the
 *   first-run carousel has finished (hasSeenOnboarding-equivalent flag set),
 *   so the tour can never run underneath the carousel. Web guests never
 *   qualify — a new web user gets the tour when they sign up, via the epoch.
 */
export function tourEligible(user: { created_at?: string } | null | undefined): boolean {
  if (user) {
    const created = Date.parse(user.created_at ?? "");
    if (Number.isNaN(created)) return false;
    return created >= Date.parse(TOUR_EPOCH_ISO);
  }
  return readFlagStrict(FRESH_INSTALL_KEY) && readFlagStrict(NATIVE_ONBOARDED_KEY);
}

// QA helper — clears the tour flags so the flow can be replayed on-device.
// Wired to window.__resetTips in non-production (see SpotlightTour).
export function resetTips(): void {
  try {
    localStorage.removeItem(tipKey("app-tour"));
    localStorage.removeItem(FRESH_INSTALL_KEY);
  } catch {
    // ignore
  }
}

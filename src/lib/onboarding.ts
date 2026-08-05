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
// Bumped v1 -> v2 (Jun 2026): the first proactive app-open prompt set this flag
// on every device it showed on, so anyone who dismissed it once was permanently
// excluded. Bumping the suffix re-arms the prompt for everyone with the rewritten
// copy, with no migration. Opted-in users still won't see UI (the inner check
// short-circuits on notifications_opt_in).
const PUSH_PROMPTED_KEY = "yourscore:push-prompted:v2";
// Separate from the signup pre-prompt: the in-context opt-in shown after a quiz
// or 38-0 match (NotifyOptInCard). Tracked on its own so converting there is
// independent of the onboarding push ask, and shown at most once across surfaces.
const QUIZ_NOTIFY_KEY = "yourscore:quiz-notify-prompted:v1";
// "Maybe later" on the pre-prompt used to write the PERMANENT flag — one tap
// killed every future push ask on the device (the exact bug that forced the
// v1→v2 key bump). A decline now snoozes instead: the asks re-arm after this.
const PUSH_SNOOZE_KEY = "yourscore:push-snoozed-until";
const PUSH_SNOOZE_DAYS = 7;

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
  if (readFlag(PUSH_PROMPTED_KEY)) return true;
  try {
    const until = Number(localStorage.getItem(PUSH_SNOOZE_KEY) ?? 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return true; // fail closed
  }
}

export function markPushPrompted(): void {
  if (!isNative()) return;
  writeFlag(PUSH_PROMPTED_KEY);
}

/** "Maybe later": suppress every push ask for a while, NOT forever. */
export function snoozePushPrompt(days: number = PUSH_SNOOZE_DAYS): void {
  if (!isNative()) return;
  try {
    localStorage.setItem(PUSH_SNOOZE_KEY, String(Date.now() + days * 86_400_000));
  } catch {
    // ignore — worst case the ask shows again sooner
  }
}

// ─────────────────────────────────────────── push ask cadence
//
// The old model asked ONCE and then went quiet for 7 days on a decline. Founder
// call: ask on effectively every app open instead, because the opt-in rate is
// the ceiling on every push feature we have — 335 opted in against 10,438
// profiles, and only 301 devices have ever granted.
//
// What the cadence CANNOT change, and why this branches on OS state:
// iOS shows its permission dialog exactly once, ever. After a user denies it,
// requestPermissions() returns "denied" immediately with no dialog. So asking a
// denied user every launch would show a card whose button visibly does nothing —
// worse than not asking. Those users get a rare ask that routes to Settings; the
// aggressive cadence applies only to users the OS will still show a dialog for.

const PUSH_ASK_KEY = "yourscore:push-ask:v1";
/** Resume fires this on tab switches too; without a floor the card would flicker
 *  back seconds after a decline. */
const ASK_COOLDOWN_MS = 30 * 60_000;
/** Declines before the every-open cadence relaxes. Someone who has said no six
 *  times is telling us something, and an app that won't listen gets deleted. */
const SOFTEN_AFTER_DECLINES = 5;
const SOFTENED_GAP_MS = 24 * 3_600_000;
/** OS-denied: the ask can only point at Settings, so it stays rare. */
const DENIED_GAP_MS = 14 * 86_400_000;

export interface PushAskState { declines: number; lastAskAt: number }

function readAskState(): PushAskState {
  try {
    const raw = localStorage.getItem(PUSH_ASK_KEY);
    if (!raw) return { declines: 0, lastAskAt: 0 };
    const p = JSON.parse(raw) as Partial<PushAskState>;
    return { declines: Number(p.declines) || 0, lastAskAt: Number(p.lastAskAt) || 0 };
  } catch {
    // Fail CLOSED here, unlike the flags above: a storage error should mean
    // "recently asked", never "ask on every single render".
    return { declines: 0, lastAskAt: Date.now() };
  }
}

function writeAskState(s: PushAskState): void {
  try { localStorage.setItem(PUSH_ASK_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** OS permission as Capacitor reports it. */
export type PushPermission = "granted" | "denied" | "prompt";

/**
 * The cadence decision, as a pure function of state.
 *
 * Split out from `shouldAskPush` so it can be tested without a browser: the
 * wrapper below needs isNative() and localStorage, neither of which exists in a
 * test or a server render, and this is the part with the actual rules in it.
 */
export function nextAsk(
  permission: PushPermission,
  state: PushAskState,
  now: number,
): boolean {
  if (permission === "granted") return false;
  const since = now - state.lastAskAt;
  if (since < ASK_COOLDOWN_MS) return false;
  if (permission === "denied") return since > DENIED_GAP_MS;
  return state.declines < SOFTEN_AFTER_DECLINES ? true : since > SOFTENED_GAP_MS;
}

/** Should the ask appear on this app open? */
export function shouldAskPush(permission: PushPermission, now = Date.now()): boolean {
  if (!isNative()) return false; // web cannot receive push at all
  return nextAsk(permission, readAskState(), now);
}

export function recordPushAsk(now = Date.now()): void {
  if (!isNative()) return;
  writeAskState({ ...readAskState(), lastAskAt: now });
}

export function recordPushDecline(now = Date.now()): void {
  if (!isNative()) return;
  const s = readAskState();
  writeAskState({ declines: s.declines + 1, lastAskAt: now });
}

/** Granted — stop asking, and reset so a later revoke starts from a clean slate. */
export function clearPushAsk(): void {
  if (!isNative()) return;
  try { localStorage.removeItem(PUSH_ASK_KEY); } catch { /* ignore */ }
}

export function hasPromptedQuizNotify(): boolean {
  if (!isNative()) return true;
  return readFlag(QUIZ_NOTIFY_KEY);
}

export function markQuizNotifyPrompted(): void {
  if (!isNative()) return;
  writeFlag(QUIZ_NOTIFY_KEY);
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

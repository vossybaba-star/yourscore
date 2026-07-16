"use client";

/**
 * "Notify me" state for halftime quizzes.
 *
 * ONE module-level store, read through useSyncExternalStore — NOT per-component
 * useState. The same fixture appears on two surfaces at once (the Your-next-quiz
 * tile and its card in the upcoming carousel); with local state each copy kept
 * its own truth and tapping the tile left the carousel card still saying
 * "Notify me" for the very same match. A shared store makes that impossible.
 *
 * Toggling is optimistic (the tap should feel instant) and rolls back if the
 * write fails, so the button never claims a reminder the server rejected.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import { isNative } from "@/lib/native";

export interface RemindersState {
  /** Fixture ids the viewer has asked to be notified about. */
  ids: Set<number>;
  signedIn: boolean;
  /** Whether they've consented to notifications at all (release requires it). */
  optedIn: boolean;
  loaded: boolean;
  /** Toggle one fixture. Returns an error message, or null on success. */
  toggle: (fixtureId: number) => Promise<string | null>;
  /**
   * Remember this fixture across a sign-in round-trip. Call before sending
   * someone to auth so we can finish what they asked for when they land back.
   */
  rememberIntent: (fixtureId: number) => void;
  /** Ask for notification permission + consent, then apply any pending intent. */
  grantConsent: () => Promise<string | null>;
  /** True when a web reminder was just set and we should pitch the app. */
  nudge: boolean;
  dismissNudge: () => void;
}

/**
 * The fixture someone tapped "Notify me" on BEFORE they were able to. Survives
 * the sign-in redirect (localStorage, not memory) so we can finish the job when
 * they come back, instead of dumping them on the page with nothing done.
 */
const PENDING_KEY = "ys:pending-reminder";

function readPending(): number | null {
  try {
    const v = window.localStorage.getItem(PENDING_KEY);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null; // private mode / storage disabled — the tap just doesn't survive
  }
}
function writePending(fixtureId: number | null) {
  try {
    if (fixtureId === null) window.localStorage.removeItem(PENDING_KEY);
    else window.localStorage.setItem(PENDING_KEY, String(fixtureId));
  } catch {
    /* non-fatal */
  }
}

interface Snap {
  ids: Set<number>;
  signedIn: boolean;
  optedIn: boolean;
  loaded: boolean;
  preview: boolean;
  nudge: boolean;
}

const EMPTY: Snap = { ids: new Set(), signedIn: false, optedIn: false, loaded: false, preview: false, nudge: false };
let snap: Snap = EMPTY;

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function set(patch: Partial<Snap>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

/**
 * DEV-ONLY: `?club=Arsenal` already means "preview the page as this fan", so it
 * also implies a signed-in, notifications-on viewer. Without it the demo (which
 * has no auth) can only ever render the signed-out button, which makes the real
 * states impossible to review. Compiled out of production; toggles stay local.
 */
function devPreview(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("club");
}

/**
 * Can we act on a reminder for this viewer right now?
 * Native needs push consent (a push is the only channel there). Web does NOT:
 * push is native-only, so a web reminder is delivered by email, and demanding
 * push consent would block a channel it has nothing to do with.
 */
function canRemind(): boolean {
  return snap.signedIn && (snap.optedIn || !isNative());
}

let started = false;
async function load() {
  if (started) return;
  started = true;

  if (devPreview()) {
    set({ preview: true, signedIn: true, optedIn: true, loaded: true });
    return;
  }
  try {
    const res = await fetch("/api/halftime/reminders", { cache: "no-store" });
    const j = await res.json();
    set({
      ids: new Set<number>((j.fixtureIds ?? []).map(Number)),
      signedIn: Boolean(j.signedIn),
      optedIn: Boolean(j.optedIn),
      loaded: true,
    });

    // They tapped "Notify me", we sent them to sign in, and here they are. Finish
    // it — landing back with the button still saying "Notify me" is exactly the
    // dead end the redirect was meant to avoid.
    const pending = readPending();
    if (pending && canRemind()) {
      if (!snap.ids.has(pending)) await postToggle(pending, true);
      writePending(null);
    }
    // Native + no consent → keep the intent; the auto-resume below runs the
    // consent flow and applies it on success.
  } catch {
    set({ loaded: true }); // transient — render the signed-out button, not a spinner forever
  }
}

/** Guards the auto-resume so a declined OS prompt can't re-fire in a loop. */
let consentResumed = false;

/**
 * The app pitch after a WEB reminder. Web can't be pushed (push is native-only),
 * so the reminder falls back to email and we lead with the app — but a fan who
 * sets six reminders shouldn't be pitched six times. Weekly, on its own key so it
 * doesn't collide with AppMomentPrompt's cooldown.
 */
const NUDGE_KEY = "ys:notify-app-nudge";
const NUDGE_COOLDOWN = 7 * 86_400_000;

function nudgeDue(): boolean {
  try {
    return Date.now() - Number(window.localStorage.getItem(NUDGE_KEY) || 0) > NUDGE_COOLDOWN;
  } catch {
    return false; // storage blocked → fail closed, don't nag
  }
}
function stampNudge() {
  try {
    window.localStorage.setItem(NUDGE_KEY, String(Date.now()));
  } catch {
    /* non-fatal */
  }
}

/**
 * Turn notifications on, IN ORDER: OS permission + device token first
 * (registerForPush is the ONLY thing that creates a token), then the consent
 * flag, then whatever they were trying to do. Flipping the flag without a token
 * would mark them notifiable and then silently deliver nothing — the exact
 * "skip them" failure this flow exists to remove.
 */
async function doGrantConsent(): Promise<string | null> {
  if (snap.preview) {
    set({ optedIn: true });
    return null;
  }
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return "Sign in first";

    await registerForPush(supabase as never, userId);

    const { error } = await supabase.from("profiles").update({ notifications_opt_in: true }).eq("id", userId);
    if (error) return "Couldn't turn notifications on";
    set({ optedIn: true });

    // Finish what they originally tapped.
    const pending = readPending();
    if (pending) {
      const err = await postToggle(pending, true);
      writePending(null);
      if (err) return err;
    }
    return null;
  } catch {
    return "Couldn't turn notifications on";
  }
}

const resumeConsent = doGrantConsent;

/** POST one toggle and fold the result into the store. Returns an error or null. */
async function postToggle(fixtureId: number, on: boolean): Promise<string | null> {
  const before = snap.ids;
  const next = new Set(before);
  if (on) next.add(fixtureId); else next.delete(fixtureId);
  set({ ids: next }); // optimistic

  try {
    const res = await fetch("/api/halftime/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId, on }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      set({ ids: before }); // roll back — never claim a reminder the server refused
      return (body as { error?: string }).error ?? "Couldn't save that";
    }
    return null;
  } catch {
    set({ ids: before });
    return "Couldn't save that";
  }
}

export function useReminders(): RemindersState {
  const s = useSyncExternalStore(subscribe, () => snap, () => EMPTY);

  useEffect(() => { load(); }, []);

  /**
   * They tapped "Notify me", we sent them to sign in, and they're back — but
   * still haven't consented. Continue the flow automatically rather than making
   * them tap again: this prompt IS their earlier tap, resumed. Fires at most
   * once per page load, so a decline can't loop the OS prompt.
   */
  useEffect(() => {
    if (!s.loaded || !s.signedIn || s.optedIn || consentResumed) return;
    // Native only: on web there is no push to consent to — load() has already
    // applied the pending reminder, and email delivers it.
    if (typeof window === "undefined" || !isNative() || !readPending()) return;
    consentResumed = true;
    void resumeConsent();
  }, [s.loaded, s.signedIn, s.optedIn]);

  const toggle = useCallback(async (fixtureId: number): Promise<string | null> => {
    const wasOn = snap.ids.has(fixtureId);
    const turningOn = !wasOn;

    // Turning a reminder ON from the web: it'll be delivered by email (no push
    // channel here), so lead with the app — the whistle is instant there and the
    // pack only lives for the interval.
    const pitchApp = turningOn && !isNative() && nudgeDue();

    if (snap.preview) {
      const next = new Set(snap.ids);
      if (wasOn) next.delete(fixtureId); else next.add(fixtureId);
      set({ ids: next, nudge: pitchApp });
      return null; // dev preview — nothing is written anywhere
    }

    const err = await postToggle(fixtureId, turningOn);
    if (!err && pitchApp) set({ nudge: true });
    return err;
  }, []);

  const rememberIntent = useCallback((fixtureId: number) => {
    writePending(fixtureId);
  }, []);

  const dismissNudge = useCallback(() => {
    stampNudge();
    set({ nudge: false });
  }, []);

  const grantConsent = useCallback(() => doGrantConsent(), []);

  return {
    ids: s.ids,
    signedIn: s.signedIn,
    optedIn: s.optedIn,
    loaded: s.loaded,
    toggle,
    rememberIntent,
    grantConsent,
    nudge: s.nudge,
    dismissNudge,
  };
}

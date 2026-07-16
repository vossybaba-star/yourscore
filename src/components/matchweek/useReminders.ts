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

export interface RemindersState {
  /** Fixture ids the viewer has asked to be notified about. */
  ids: Set<number>;
  signedIn: boolean;
  /** Whether they've consented to notifications at all (release requires it). */
  optedIn: boolean;
  loaded: boolean;
  /** Toggle one fixture. Returns an error message, or null on success. */
  toggle: (fixtureId: number) => Promise<string | null>;
}

interface Snap {
  ids: Set<number>;
  signedIn: boolean;
  optedIn: boolean;
  loaded: boolean;
  preview: boolean;
}

const EMPTY: Snap = { ids: new Set(), signedIn: false, optedIn: false, loaded: false, preview: false };
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
  } catch {
    set({ loaded: true }); // transient — render the signed-out button, not a spinner forever
  }
}

export function useReminders(): RemindersState {
  const s = useSyncExternalStore(subscribe, () => snap, () => EMPTY);

  useEffect(() => { load(); }, []);

  const toggle = useCallback(async (fixtureId: number): Promise<string | null> => {
    const before = snap.ids;
    const wasOn = before.has(fixtureId);
    const next = new Set(before);
    if (wasOn) next.delete(fixtureId); else next.add(fixtureId);
    set({ ids: next }); // optimistic

    if (snap.preview) return null; // dev preview — nothing is written anywhere

    try {
      const res = await fetch("/api/halftime/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId, on: !wasOn }),
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
  }, []);

  return { ids: s.ids, signedIn: s.signedIn, optedIn: s.optedIn, loaded: s.loaded, toggle };
}

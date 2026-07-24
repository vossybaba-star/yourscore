"use client";

/**
 * "Is the screen underneath an error screen?" — asked by the global prompts
 * (UsernamePrompt, ClubPrompt, WcThanksPrompt), which are mounted in the root
 * layout and therefore render over whatever the route produced, including a 404
 * or a crash. Onboarding stacked on top of an error page is the worst version of
 * both: the modal buries the one thing that explains what happened, and the way
 * out sits behind two dismissals.
 *
 * Those prompts already suppress themselves by pathname (/auth, /settings), but
 * that can't work here — a 404's pathname is whatever URL was mistyped, so there
 * is nothing to match on. The error screen has to announce itself instead:
 * not-found.tsx and RouteError render <ErrorRouteMarker />, and the prompts ask
 * useOnErrorRoute().
 *
 * A counter, not a boolean, so a nested error boundary unmounting doesn't clear
 * the flag while an outer one is still on screen.
 */

import { useEffect, useSyncExternalStore } from "react";

let depth = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => depth > 0;
const getServerSnapshot = () => false;

export function useOnErrorRoute() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Rendered by the error screens themselves; flags the route while mounted. */
export function ErrorRouteMarker() {
  useEffect(() => {
    depth += 1;
    listeners.forEach((l) => l());
    return () => {
      depth -= 1;
      listeners.forEach((l) => l());
    };
  }, []);
  return null;
}

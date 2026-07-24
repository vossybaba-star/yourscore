"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js, which caches the immutable build assets so the app stops
 * re-downloading them on every cold start. See src/app/sw.js/route.ts for what
 * the worker does and why it is served from a route handler.
 *
 * Deliberately quiet about updates. A new worker calls skipWaiting + clients.claim
 * and takes over straight away, but this never reloads the page to hand over —
 * doing that mid-game would throw away someone's run to save them one round-trip.
 * The new assets are picked up on the next navigation, which is soon enough.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration competes with everything the app does on first paint, and it
    // is pure future benefit — nothing on this load depends on it. Wait for the
    // page to settle before spending the request.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        // A failed registration is not worth breaking anything over: the app runs
        // exactly as it did before, just without the cache.
        console.warn("[sw] registration failed", err);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

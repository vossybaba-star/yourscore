"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isNative } from "@/lib/native";

/**
 * Warms the connection + router cache when the app comes back to the foreground.
 *
 * The native app has no local bundle — `capacitor.config.ts` points the webview
 * straight at https://yourscore.app — so every screen is a network fetch. Lock the
 * phone and iOS suspends the webview: the TLS connections die, the radio sleeps,
 * and Next's router cache goes stale (30s for dynamic routes). Nothing was
 * prefetched during a game either, because the game screen hides BottomNav.
 *
 * So the FIRST tap after a resume pays DNS + TLS + auth + RSC before anything
 * moves on screen — measured ~1.9s cold on wifi, several seconds on a phone
 * waking its radio. That's the "I locked my phone, came back, and couldn't get out
 * of the game" report.
 *
 * Doing the same work here spends it during the resume, while the player is still
 * looking at the screen they left, instead of on the tap.
 */

/** Tab routes a player is most likely to reach for when they come back. */
const WARM_ROUTES = ["/", "/play", "/versus", "/matchweek"];

/** A quick app-switch leaves the sockets alive — only warm after a real absence. */
const AWAY_MS = 15_000;

/** Ceiling on how often this can fire, however often the app flips foreground. */
const THROTTLE_MS = 60_000;

/** Gap between prefetches — see the comment in `warm`. */
const STAGGER_MS = 150;

export function ResumePrefetch() {
  const router = useRouter();
  const hiddenAtRef = useRef<number | null>(null);
  const lastWarmRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const warm = async () => {
      const now = Date.now();
      if (now - lastWarmRef.current < THROTTLE_MS) return;
      lastWarmRef.current = now;

      for (const route of WARM_ROUTES) {
        if (cancelled) return;
        router.prefetch(route);
        // Staggered, not parallel: the first request alone re-does DNS + TLS and
        // the rest ride the socket it opens. Firing all four at once just makes
        // them race for a radio that is still waking up.
        await new Promise((r) => setTimeout(r, STAGGER_MS));
      }
    };

    /** Only warm if we were genuinely away — otherwise this fires on every blur. */
    const wasAwayLongEnough = () => {
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      return hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (wasAwayLongEnough()) void warm();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    // Native belt and braces: WKWebView does fire visibilitychange on
    // background/foreground, but not dependably across iOS versions and not at all
    // in some backgrounded states. Capacitor's own lifecycle event always fires.
    let removeNativeListener: (() => void) | null = null;
    if (isNative()) {
      void (async () => {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) {
            hiddenAtRef.current = Date.now();
            return;
          }
          if (wasAwayLongEnough()) void warm();
        });
        if (cancelled) handle.remove();
        else removeNativeListener = () => handle.remove();
      })();
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removeNativeListener?.();
    };
  }, [router]);

  return null;
}

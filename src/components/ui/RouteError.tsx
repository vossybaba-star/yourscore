"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { ErrorRouteMarker } from "@/components/app/errorRoute";

/**
 * A failed JS chunk fetch, which is what a navigation hits when the deploy it was
 * loaded from has been replaced. The page is running old code asking for filenames
 * that no longer exist, so `reset()` can never fix it — only a fresh document can.
 * Different bundlers/browsers word this several ways; match all of them.
 */
function isStaleChunkError(error: Error): boolean {
  if (error?.name === "ChunkLoadError") return true;
  const m = `${error?.message ?? ""}`;
  return (
    /Loading chunk \S+ failed/i.test(m) ||
    /Loading CSS chunk/i.test(m) ||
    /Cannot find module ['"`]?\.\//i.test(m) ||
    /__webpack_modules__\[\S+\] is not a function/i.test(m) ||
    /(Failed to fetch|error loading) dynamically imported module/i.test(m)
  );
}

// One auto-reload per window per 30s. Without this guard a chunk error that
// survives the reload (an asset genuinely gone, an offline device) would put the
// tab in a refresh loop, which is far worse than the error screen.
const RELOAD_KEY = "ys:chunk-reload-at";
function tryReloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // storage blocked — don't risk an unguarded loop
  }
  window.location.reload();
  return true;
}

/**
 * Shared fallback UI for App Router error boundaries (`error.tsx`). A thrown error
 * in a page/segment renders this instead of white-screening the whole app: the root
 * layout (nav) stays mounted, the user gets "Try again" (re-renders the segment) and
 * "Home", and the error is still reported to Sentry (matching global-error.tsx).
 *
 * Stale-chunk errors are handled before any of that: they are the app being out of
 * date rather than broken, and they were the top cause of a tab tap dying with no
 * way forward, so they self-recover with a reload instead of showing an error.
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
  message = "That screen hit a snag. Try again, or head home.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
}) {
  const stale = isStaleChunkError(error);

  useEffect(() => {
    if (stale) {
      // Tagged, not silenced: a spike still needs to be visible, but it is an
      // "app was updated" event rather than a code fault.
      Sentry.captureException(error, { tags: { stale_chunk: "true" } });
      if (tryReloadOnce()) return; // reloading — don't paint the error screen
      return;
    }
    Sentry.captureException(error);
  }, [error, stale]);

  // Reached only when the auto-reload was suppressed (already tried, or no storage).
  const heading = stale ? "Updating…" : title;
  const body = stale ? "A new version just shipped. Reload to pick it up." : message;
  // reset() re-renders the same stale code, so for a chunk error the recovery
  // action has to be a real document fetch.
  const retry = stale ? () => window.location.reload() : reset;

  return (
    <div style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#0a0a0f" }}>
      <ErrorRouteMarker />
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
        <h1 className="font-display" style={{ fontSize: 20, color: "#ffffff", margin: 0 }}>{heading}</h1>
        <p className="font-body" style={{ fontSize: 14, color: "#8a948f", marginTop: 8, lineHeight: 1.5 }}>{body}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
          <button
            onClick={retry}
            className="font-body"
            style={{ padding: "10px 18px", borderRadius: 12, border: "none", background: "#aeea00", color: "#0a0a0f", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
          <Link
            href="/"
            className="font-body"
            style={{ padding: "10px 18px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#ffffff", textDecoration: "none" }}
          >
            Home
          </Link>
        </div>
        {error?.digest && (
          <p className="font-body" style={{ fontSize: 10, color: "#3a423d", marginTop: 14 }}>ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}

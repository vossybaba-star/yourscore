"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { ErrorRouteMarker } from "@/components/app/errorRoute";

/**
 * Shared fallback UI for App Router error boundaries (`error.tsx`). A thrown error
 * in a page/segment renders this instead of white-screening the whole app: the root
 * layout (nav) stays mounted, the user gets "Try again" (re-renders the segment) and
 * "Home", and the error is still reported to Sentry (matching global-error.tsx).
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
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#0a0a0f" }}>
      <ErrorRouteMarker />
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
        <h1 className="font-display" style={{ fontSize: 20, color: "#ffffff", margin: 0 }}>{title}</h1>
        <p className="font-body" style={{ fontSize: 14, color: "#8a948f", marginTop: 8, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
          <button
            onClick={reset}
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

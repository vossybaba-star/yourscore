"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Root-layout crash fallback — the worst-case screen. It can't use shared
 * components or globals.css (the layout that loads them is what failed), so
 * everything is inline-styled to match the brand. Must always offer a way out:
 * inside the native wrap there's no browser chrome to escape with.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#0a0a0f",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 44 }}>⚽</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: 0.5 }}>
          YOUR<span style={{ color: "#ffb800" }}>SCORE</span> hit the post
        </h1>
        <p style={{ fontSize: 14, color: "#8a948f", margin: 0, maxWidth: 320, lineHeight: 1.5 }}>
          Something broke on our side. Your scores are safe — try again or head home.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            onClick={() => reset()}
            style={{
              padding: "12px 22px",
              borderRadius: 14,
              border: "none",
              background: "#aeea00",
              color: "#062013",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: "12px 22px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Home
          </a>
        </div>
      </body>
    </html>
  );
}

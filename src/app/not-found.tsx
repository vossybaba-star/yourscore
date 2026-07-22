import type { Metadata } from "next";
import Link from "next/link";
import { ErrorRouteMarker } from "@/components/app/errorRoute";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Root 404. Without this, an unmatched URL renders Next's default black-on-white
 * page: no brand, no nav, no way back. That matters most for links we don't
 * control — a mistyped ad destination, a stale share link — where the visitor's
 * first impression of YourScore is the page that failed. Send them to a game
 * instead of a dead end.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "60dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0a0a0f",
      }}
    >
      <ErrorRouteMarker />
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>⚽</div>
        <h1 className="font-display" style={{ fontSize: 20, color: "#ffffff", margin: 0 }}>
          Off target
        </h1>
        <p
          className="font-body"
          style={{ fontSize: 14, color: "#8a948f", marginTop: 8, lineHeight: 1.5 }}
        >
          That page doesn&apos;t exist. The games are this way.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
          <Link
            href="/play"
            className="font-body"
            style={{
              padding: "10px 18px",
              borderRadius: 12,
              background: "#aeea00",
              color: "#0a0a0f",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Play a game
          </Link>
          <Link
            href="/"
            className="font-body"
            style={{
              padding: "10px 18px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#ffffff",
              textDecoration: "none",
            }}
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

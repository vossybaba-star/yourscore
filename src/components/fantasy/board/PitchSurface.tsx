import type { ReactNode } from "react";
import { TEAL } from "@/components/fantasy/shared";

/**
 * The tactical pitch — a SQUARE playing area (a real pitch is ~1.6:1, but the
 * square keeps five across a row readable on a 375px phone). Deep green-black
 * wash, faint mow stripes, thin teal markings. Presentational only: the caller
 * drops the formation rows in as children, absolutely filling it.
 *
 * Extracted verbatim from the hub's inline pitch so every Fantasy surface draws
 * the same field instead of three subtly different ones.
 */
/** Which corners of the pitch art to round. "all" when the pitch is the whole
 *  card (build/plan); "left" when a dugout sits to its right, so the seam between
 *  them stays square and only the card's outer edge curves. */
export function PitchSurface({ children, round = "all" }: { children: ReactNode; round?: "all" | "left" }) {
  // The art layers are clipped to the rounded corners, but the players and any
  // open menu are NOT — a tap-menu must be able to overflow the pitch edge
  // instead of being sheared off by a card-wide `overflow: hidden`.
  const artRadius = round === "left" ? "16px 0 0 16px" : 16;
  return (
    <div style={{ flex: 1, minWidth: 0, position: "relative", aspectRatio: "1 / 1" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: artRadius }}>
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, #0c1a13 0%, #0a1710 55%, #091510 100%)",
        }} />
        <div style={{
          position: "absolute", inset: 0, opacity: 0.28,
          background: "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0 24px, transparent 24px 48px)",
        }} />
        <svg viewBox="0 0 100 100"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.2 }}>
          <rect x="2" y="2" width="96" height="96" fill="none" stroke={TEAL} strokeWidth="0.7" />
          <line x1="2" y1="50" x2="98" y2="50" stroke={TEAL} strokeWidth="0.7" />
          <circle cx="50" cy="50" r="13" fill="none" stroke={TEAL} strokeWidth="0.7" />
          <circle cx="50" cy="50" r="1.2" fill={TEAL} />
          <rect x="25" y="2" width="50" height="16" fill="none" stroke={TEAL} strokeWidth="0.7" />
          <rect x="37" y="2" width="26" height="7" fill="none" stroke={TEAL} strokeWidth="0.7" />
          <rect x="25" y="82" width="50" height="16" fill="none" stroke={TEAL} strokeWidth="0.7" />
          <rect x="37" y="91" width="26" height="7" fill="none" stroke={TEAL} strokeWidth="0.7" />
        </svg>
      </div>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: "5% 4%",
      }}>
        {children}
      </div>
    </div>
  );
}

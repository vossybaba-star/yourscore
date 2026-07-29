"use client";
/**
 * "Compare players" — the Briefing's entry into Player Comparison.
 *
 * The Players + Shortlist rows open the comparison with a player already chosen;
 * the Briefing has no single player in hand, so this opens it empty (both sides
 * to be picked). A thin client island so /fantasy/news stays a server component.
 */
import { useState } from "react";
import { PlayerComparison } from "@/components/fantasy/PlayerComparison";

const TEAL = "#00d8c0";
const PANEL = "#0e1611";
const LINE = "rgba(255,255,255,0.07)";
const INK = "#eef2f0";
const MUTED = "#8a948f";

export function CompareEntry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          width: "100%", textAlign: "left", cursor: "pointer",
          background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px",
        }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center",
            background: "rgba(0,216,192,0.12)", border: `1px solid ${TEAL}55`,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h6M4 12h6M4 17h6" />
              <path d="M14 7h6M14 12h6M14 17h6" opacity="0.55" />
              <path d="M12 3v18" />
            </svg>
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: INK }}>Compare players</span>
            <span style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 1 }}>
              Two players, side by side, on the facts.
            </span>
          </span>
        </span>
        <span aria-hidden style={{ color: MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
      </button>
      {open && <PlayerComparison onClose={() => setOpen(false)} />}
    </>
  );
}

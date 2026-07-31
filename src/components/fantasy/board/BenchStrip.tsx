import type { ReactNode } from "react";
import { TEAL, tint } from "@/components/fantasy/shared";

// Wider than the bare avatar column: each sub now carries a position tag to its
// right (GK/DEF/MID/FWD), so the dugout needs room for the name and the tag.
const DUGOUT_W = 96;

/**
 * The dugout — the four subs down the touchline, off the field. A labelled
 * column so the bench is obviously separate from the XI (a sub who scores only
 * counts if a starter blanks). The caller drops the bench markers in as children.
 */
export function BenchStrip({ children }: { children: ReactNode }) {
  return (
    <div style={{
      width: DUGOUT_W, flexShrink: 0, padding: "8px 5px",
      borderLeft: `1px dashed ${tint(TEAL, "26")}`, background: "rgba(0,0,0,0.28)",
      // The card no longer clips this strip, so round its own outer corners.
      borderRadius: "0 16px 16px 0",
      display: "flex", flexDirection: "column", gap: 5,
    }}>
      <div className="font-display tracking-widest"
        style={{ fontSize: 8, color: "#5b645e", textAlign: "center", lineHeight: 1.2 }}>
        DUGOUT
      </div>
      {children}
    </div>
  );
}

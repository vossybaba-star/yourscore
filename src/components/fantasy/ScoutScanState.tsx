"use client";
/**
 * The Scout's branded wait state — a real pitch with a calm teal sweep, not
 * a spinner. Used on the signed-out /fantasy/rate flow (reading the
 * screenshot, then grading the team) and reused for signed-in rating so
 * members get the same branded feel. Respects prefers-reduced-motion via
 * the .scout-scan-sweep class in globals.css (animation dropped, sweep
 * stays put at a fixed opacity).
 */
import { INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";

export function ScoutScanState({ heading, subline }: { heading: string; subline: string }) {
  return (
    <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, overflow: "hidden" }}>
      <PitchSurface>
        <div aria-hidden className="scout-scan-sweep" style={{
          position: "absolute", left: "8%", right: "8%", height: "18%", borderRadius: 10,
          background: `linear-gradient(180deg, transparent, ${tint(TEAL, "40")}, transparent)`,
        }} />
      </PitchSurface>
      <div style={{ padding: 16, background: PANEL }}>
        <div className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 6 }}>{heading}</div>
        <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>{subline}</p>
      </div>
    </div>
  );
}

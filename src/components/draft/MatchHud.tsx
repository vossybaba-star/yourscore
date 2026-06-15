"use client";

/**
 * 38-0 — shared match HUD chrome: the clock + aggregate scoreline header and the
 * ticking stat bars. Used by <MatchPitch> (and previously the text <MatchWatch>),
 * so the scoreboard styling lives in one place.
 */

import type { TickStats } from "@/lib/draft/playback";

export const ME = "#aeea00";
export const OPP = "#ff5c7a";

export function ScoreHeader({
  minute, myName, oppName, myGoals, oppGoals,
}: {
  minute: number;
  myName: string;
  oppName: string;
  myGoals: number;
  oppGoals: number;
}) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center gap-2 rounded-full px-3 py-1" style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.3)" }}>
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: ME, animation: "pulse 1s infinite" }} />
        <span className="font-display tabular-nums" style={{ fontSize: 15, color: ME, letterSpacing: 1 }}>{Math.max(1, minute)}&apos;</span>
      </div>
      <div className="flex items-center justify-center gap-3 mt-3">
        <span className="font-display tracking-wide truncate text-right" style={{ fontSize: 16, color: "#c4ccc6", maxWidth: 120 }}>{myName}</span>
        <span className="font-display tabular-nums" style={{ fontSize: 46, fontWeight: 900, color: "#fff" }}>{myGoals}</span>
        <span style={{ color: "#555", fontSize: 26 }}>–</span>
        <span className="font-display tabular-nums" style={{ fontSize: 46, fontWeight: 900, color: "#fff" }}>{oppGoals}</span>
        <span className="font-display tracking-wide truncate text-left" style={{ fontSize: 16, color: "#c4ccc6", maxWidth: 120 }}>{oppName}</span>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}

export function StatBars({ stats, meSide }: { stats: TickStats; meSide: "a" | "b" }) {
  const mineFirst = (a: number, b: number): [number, number] => (meSide === "a" ? [a, b] : [b, a]);
  const rows: [string, number, number, boolean][] = [
    ["Possession", ...mineFirst(stats.possession.a, stats.possession.b), true],
    ["Shots", ...mineFirst(stats.shots.a, stats.shots.b), false],
    ["On target", ...mineFirst(stats.shotsOnTarget.a, stats.shotsOnTarget.b), false],
    ["Corners", ...mineFirst(stats.corners.a, stats.corners.b), false],
    ["Fouls", ...mineFirst(stats.fouls.a, stats.fouls.b), false],
  ];
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
      {rows.map(([label, mine, theirs, pct]) => (
        <div key={label} className="flex items-center px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <span className="flex-1 text-left font-body tabular-nums font-bold" style={{ fontSize: 15, color: mine >= theirs ? "#fff" : "#8a948f" }}>{mine}{pct ? "%" : ""}</span>
          <span className="text-center font-body" style={{ width: 110, fontSize: 10, letterSpacing: 1, color: "#8a948f" }}>{label.toUpperCase()}</span>
          <span className="flex-1 text-right font-body tabular-nums font-bold" style={{ fontSize: 15, color: theirs >= mine ? "#fff" : "#8a948f" }}>{theirs}{pct ? "%" : ""}</span>
        </div>
      ))}
    </div>
  );
}

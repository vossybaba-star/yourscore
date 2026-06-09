"use client";

/**
 * 38-0 — <MatchWatch>: plays a half out on screen. Purely presentational — it reads
 * everything from playback.watchFrame() given an injected `progress` (0→1). The
 * caller owns timing (live: the phase deadline; quick match: a local ticker).
 */

import { useEffect, useRef } from "react";
import { watchFrame, type Beat, type TickStats } from "@/lib/draft/playback";
import type { HalfSim } from "@/lib/draft/live-score";

const ME = "#00ff87";
const OPP = "#ff5c7a";

export function MatchWatch({
  sim, half, matchId, progress, priorGoals, meSide, myName, oppName,
}: {
  sim: HalfSim;
  half: 1 | 2;
  matchId: string;
  progress: number;
  priorGoals: { a: number; b: number };
  meSide: "a" | "b";
  myName: string;
  oppName: string;
}) {
  const frame = watchFrame(sim, half, matchId, progress);
  const mineFirst = <T,>(a: T, b: T): [T, T] => (meSide === "a" ? [a, b] : [b, a]);

  const [myGoals, oppGoals] = mineFirst(
    priorGoals.a + frame.goalsA,
    priorGoals.b + frame.goalsB,
  );

  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frame.feed.length]);

  const minute = Math.max(1, frame.clockMinute);

  return (
    <div>
      {/* Clock + scoreline */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1" style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.3)" }}>
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: ME, animation: "pulse 1s infinite" }} />
          <span className="font-display tabular-nums" style={{ fontSize: 15, color: ME, letterSpacing: 1 }}>{minute}&apos;</span>
        </div>
        <div className="flex items-center justify-center gap-3 mt-3">
          <span className="font-display tracking-wide truncate text-right" style={{ fontSize: 16, color: "#cfcfe6", maxWidth: 120 }}>{myName}</span>
          <span className="font-display tabular-nums" style={{ fontSize: 46, fontWeight: 900, color: "#fff" }}>{myGoals}</span>
          <span style={{ color: "#555", fontSize: 26 }}>–</span>
          <span className="font-display tabular-nums" style={{ fontSize: 46, fontWeight: 900, color: "#fff" }}>{oppGoals}</span>
          <span className="font-display tracking-wide truncate text-left" style={{ fontSize: 16, color: "#cfcfe6", maxWidth: 120 }}>{oppName}</span>
        </div>
      </div>

      {/* Commentary feed (newest at the bottom, auto-scrolled) */}
      <div ref={feedRef} className="mt-4 rounded-xl overflow-y-auto" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)", maxHeight: 168 }}>
        {frame.feed.map((b, i) => (
          <FeedLine key={`${b.minute}-${b.kind}-${i}`} beat={b} meSide={meSide} half={half} />
        ))}
      </div>

      {/* Live stat bars */}
      <div className="mt-4">
        <StatBars stats={frame.stats} meSide={meSide} />
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}

function FeedLine({ beat, meSide, half }: { beat: Beat; meSide: "a" | "b"; half: 1 | 2 }) {
  const isGoal = beat.kind === "goal";
  const isBookend = beat.kind === "kickoff" || beat.kind === "halftime" || beat.kind === "fulltime";
  const mine = beat.side === meSide;
  const accent = isBookend ? "#8888aa" : mine ? ME : OPP;
  const shownMinute = beat.kind === "kickoff" ? (half === 2 ? 45 : 0) : beat.minute;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <span className="font-display tabular-nums" style={{ fontSize: 12, color: "#7a7a92", width: 28 }}>{shownMinute}&apos;</span>
      <span className="font-body" style={{ fontSize: isGoal ? 14 : 12.5, color: isGoal ? accent : "#cfcfe6", fontWeight: isGoal ? 700 : 400 }}>
        {beat.text}
      </span>
    </div>
  );
}

function StatBars({ stats, meSide }: { stats: TickStats; meSide: "a" | "b" }) {
  const mineFirst = (a: number, b: number): [number, number] => (meSide === "a" ? [a, b] : [b, a]);
  const rows: [string, number, number, boolean][] = [
    ["Possession", ...mineFirst(stats.possession.a, stats.possession.b), true],
    ["Shots", ...mineFirst(stats.shots.a, stats.shots.b), false],
    ["On target", ...mineFirst(stats.shotsOnTarget.a, stats.shotsOnTarget.b), false],
    ["Corners", ...mineFirst(stats.corners.a, stats.corners.b), false],
    ["Fouls", ...mineFirst(stats.fouls.a, stats.fouls.b), false],
  ];
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
      {rows.map(([label, mine, theirs, pct]) => (
        <div key={label} className="flex items-center px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <span className="flex-1 text-left font-body tabular-nums font-bold" style={{ fontSize: 15, color: mine >= theirs ? "#fff" : "#8888aa" }}>{mine}{pct ? "%" : ""}</span>
          <span className="text-center font-body" style={{ width: 110, fontSize: 10, letterSpacing: 1, color: "#7a7a92" }}>{label.toUpperCase()}</span>
          <span className="flex-1 text-right font-body tabular-nums font-bold" style={{ fontSize: 15, color: theirs >= mine ? "#fff" : "#8888aa" }}>{theirs}{pct ? "%" : ""}</span>
        </div>
      ))}
    </div>
  );
}

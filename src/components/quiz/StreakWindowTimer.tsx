"use client";

import { useState, useEffect } from "react";

// Subtle countdown shown on a daily quiz until its on-time deadline. Finishing
// before the target UK calendar day ends (midnight) keeps/extends the daily
// streak that boosts the World Cup series leaderboard. Mirrors the deadline math
// in src/app/api/leaderboard/wc2026/route.ts — keep the two in sync.
//
// UK is BST (UTC+1) all tournament, so the end of London calendar day D is
// D 23:00 UTC (= D+1 00:00 London).
function dayEndUtc(dateStr: string): number {
  return Date.parse(`${dateStr}T23:00:00Z`);
}

export function StreakWindowTimer({ date, accent = "#aeea00" }: { date?: string | null; accent?: string }) {
  // Start null so server and first client render match (no hydration mismatch);
  // the real time is set on mount.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!date || now === null) return null;
  const end = dayEndUtc(date);
  if (Number.isNaN(end) || now >= end) return null; // hide once the deadline passes

  const remaining = end - now;
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const label = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{ background: `${accent}14`, border: `1px solid ${accent}3a` }}
      title="Finish before midnight (UK) to keep your daily streak (+10%/day, up to +50%) on the World Cup leaderboard."
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>🔥</span>
      <span className="font-body text-xs" style={{ color: accent }}>
        <span className="font-display tabular-nums">{label}</span> left to keep your streak
      </span>
    </div>
  );
}

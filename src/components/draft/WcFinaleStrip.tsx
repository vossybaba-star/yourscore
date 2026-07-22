"use client";

import { useEffect, useState } from "react";

/**
 * Finale countdown strip — the World Cup's last week is the season's biggest
 * content moment (audit 2026-07-13, approved). Shows on the WC surfaces from a
 * week out: days to the final + "the board freezes at full time". Renders
 * nothing before the window, after the final day, or during SSR (mounted-only,
 * so the day count can't hydration-mismatch across midnight).
 */
const FINAL_DAY_UK = "2026-07-19";
const SHOW_FROM_DAYS = 9;

export function WcFinaleStrip({ compact = false }: { compact?: boolean }) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    const ukToday = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const diff = Math.round(
      (new Date(`${FINAL_DAY_UK}T12:00:00Z`).getTime() - new Date(`${ukToday}T12:00:00Z`).getTime()) / 86_400_000,
    );
    setDays(diff);
  }, []);

  if (days === null || days < 0 || days > SHOW_FROM_DAYS) return null;

  const when = days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `IN ${days} DAYS`;
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-3.5 mb-3"
      style={{
        paddingTop: compact ? 8 : 10,
        paddingBottom: compact ? 8 : 10,
        background: "linear-gradient(135deg, rgba(255,215,0,0.10), rgba(255,184,0,0.04))",
        border: "1px solid rgba(255,215,0,0.35)",
      }}
    >
      <span style={{ fontSize: compact ? 16 : 20, lineHeight: 1 }}>🏆</span>
      <div className="min-w-0">
        <span className="font-display tracking-wide" style={{ fontSize: compact ? 13 : 15, color: "#ffd700" }}>
          THE FINAL — {when}
        </span>
        <span className="font-body block" style={{ fontSize: compact ? 11 : 12, color: "#cdb98a", lineHeight: 1.35 }}>
          Sunday 19 July. The season board freezes at full time — every run until then counts.
        </span>
      </div>
    </div>
  );
}

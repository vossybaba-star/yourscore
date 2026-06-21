"use client";

import { useEffect, useState } from "react";

// Live World Cup series leaderboard for the competition page. Reads the same
// /api/leaderboard/wc2026 endpoint as the in-app board (streak-boosted totals).

interface Row {
  rank: number;
  displayName: string;
  totalScore: number;
  bonusPoints: number;
  streak: number;
  quizCount: number;
  totalCorrect: number;
}

const GREEN = "#aeea00";
const MEDALS = ["🥇", "🥈", "🥉"];
const RANK_COLORS = ["#ffb800", "#9aa39d", "#cd7f32"];

export function WC2026Board() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let on = true;
    fetch("/api/leaderboard/wc2026")
      .then((r) => r.json())
      .then((d) => { if (!on) return; if (d?.rows) setRows(d.rows); else setError(true); })
      .catch(() => { if (on) setError(true); });
    return () => { on = false; };
  }, []);

  if (error) {
    return <p className="font-body text-sm" style={{ color: "#8a948f" }}>Couldn’t load the leaderboard — try again shortly.</p>;
  }
  if (!rows) {
    return <p className="font-body text-sm" style={{ color: "#8a948f" }}>Loading the leaderboard…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="font-body text-sm text-white mb-1">No scores yet.</p>
        <p className="font-body text-xs" style={{ color: "#8a948f" }}>Be the first to top the board.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
      {rows.map((r) => (
        <div key={r.rank}
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderTop: r.rank > 1 ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
          <span className="font-display text-sm w-7 text-center flex-shrink-0"
            style={{ color: r.rank <= 3 ? RANK_COLORS[r.rank - 1] : "#586058" }}>
            {r.rank <= 3 ? MEDALS[r.rank - 1] : r.rank}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-body text-sm truncate text-white">{r.displayName}</p>
            <p className="font-body text-xs mt-0.5" style={{ color: "#5b645e" }}>
              {r.quizCount} quiz{r.quizCount === 1 ? "" : "zes"} · {r.totalCorrect} correct
              {r.streak > 0 && <span style={{ color: GREEN }}>{" · 🔥 "}{r.streak}-day streak</span>}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <span className="font-display text-sm" style={{ color: GREEN }}>{r.totalScore.toLocaleString()}</span>
            {r.bonusPoints > 0 && (
              <p className="font-body text-xs" style={{ color: "#ffb800" }}>+{r.bonusPoints.toLocaleString()} streak</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

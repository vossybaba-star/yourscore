"use client";

/**
 * /xi/leaderboard — global Daily + All-time H2H win boards (the recurring
 * viral screenshot moment: a fresh race every morning). Fails soft if the cloud
 * tables aren't live yet. Custom-league boards reuse this via ?league=<id>.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/ui/BottomNav";
import { useUser } from "@/hooks/useUser";

type Row = {
  user_id: string;
  display_name: string;
  wins_today: number;
  wins_all_time: number;
  rank: number;
};

export default function Leaderboard() {
  const { user } = useUser();
  const [metric, setMetric] = useState<"today" | "all">("today");
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/draft/leaderboard?metric=${metric}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setRows(d.rows ?? []); setReady(d.ready !== false); } })
      .catch(() => { if (alive) { setRows([]); setReady(false); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [metric]);

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-2">
          <Link href="/xi" className="font-body text-sm" style={{ color: "#8888aa" }}>← Draft XI</Link>
        </div>

        <h1 className="font-display tracking-wide leading-none" style={{ fontSize: 44, color: "#fff" }}>
          LEADER<span style={{ color: "#00ff87" }}>BOARD</span>
        </h1>
        <p className="font-body mt-1 mb-4" style={{ fontSize: 13, color: "#8888aa" }}>
          Ranked by head-to-head wins. Daily resets at midnight UTC.
        </p>

        {/* tabs */}
        <div className="flex gap-1 p-1 rounded-2xl mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {([["today", "Daily"], ["all", "All-time"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setMetric(key)}
              className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
              style={metric === key ? { background: "#00ff87", color: "#062013" } : { background: "transparent", color: "#8888aa" }}>
              {label}
            </button>
          ))}
        </div>

        <Link href="/xi/leagues" className="flex items-center justify-between rounded-xl px-4 py-3 mb-4 active:scale-[0.98] transition-transform"
          style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)" }}>
          <span className="font-display tracking-wide" style={{ fontSize: 16, color: "#a78bfa" }}>🏟️ MY LEAGUES</span>
          <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>create or join a private board →</span>
        </Link>

        {loading ? (
          <div className="text-center py-10 font-body" style={{ color: "#8888aa" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
              {ready ? "NO WINS YET" : "LEADERBOARD COMING SOON"}
            </div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#8888aa" }}>
              {ready
                ? "Be the first on the board — win a ranked match."
                : "Cloud leaderboards activate once the season is live. Play Quick Matches now."}
            </p>
            <Link href="/xi" className="inline-block mt-4 rounded-xl px-5 py-3 font-display tracking-wide"
              style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}>
              BUILD YOUR XI →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const isMe = user && r.user_id === user.id;
              const wins = metric === "today" ? r.wins_today : r.wins_all_time;
              const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
              return (
                <div key={r.user_id} className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{
                    background: isMe ? "rgba(0,255,135,0.08)" : "#12121e",
                    border: `1px solid ${isMe ? "rgba(0,255,135,0.4)" : "rgba(255,255,255,0.07)"}`,
                  }}>
                  <div className="font-display tabular-nums" style={{ fontSize: 20, color: r.rank <= 3 ? "#ffb800" : "#8888aa", width: 34 }}>
                    {medal ?? r.rank}
                  </div>
                  <div className="flex-1 font-body truncate" style={{ fontSize: 15, color: "#fff" }}>
                    {r.display_name}{isMe ? " (you)" : ""}
                  </div>
                  <div className="font-display" style={{ fontSize: 22, color: "#00ff87" }}>{wins}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

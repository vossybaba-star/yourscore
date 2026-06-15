"use client";

/**
 * /38-0/leaderboard — global Daily + All-time H2H win boards (the recurring
 * viral screenshot moment: a fresh race every morning). Fails soft if the cloud
 * tables aren't live yet. Custom-league boards reuse this via ?league=<id>.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/ui/BottomNav";
import { DraftHeader } from "@/components/draft/DraftHeader";
import { useUser } from "@/hooks/useUser";
import { asLeague, type League } from "@/lib/draft/types";

type Row = {
  user_id: string;
  display_name: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  rank: number;
};

export default function Leaderboard() {
  const { user } = useUser();
  const [metric, setMetric] = useState<"today" | "all">("today");
  const [competition, setCompetition] = useState<League>("PL");
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setCompetition(asLeague(new URLSearchParams(window.location.search).get("competition"))); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/draft/leaderboard?metric=${metric}&competition=${competition}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setRows(d.rows ?? []); setReady(d.ready !== false); } })
      .catch(() => { if (alive) { setRows([]); setReady(false); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [metric, competition]);

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <DraftHeader competition={competition} />

        <h1 className="font-display tracking-wide leading-none" style={{ fontSize: 44, color: "#fff" }}>
          LEADER<span style={{ color: "#aeea00" }}>BOARD</span>
        </h1>
        <p className="font-body mt-1 mb-4" style={{ fontSize: 13, color: "#8a948f" }}>
          Ranked by points — Win 3, Draw 1. Daily resets at midnight UTC.
        </p>

        {/* tabs */}
        <div className="flex gap-1 p-1 rounded-2xl mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {([["today", "Daily"], ["all", "All-time"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setMetric(key)}
              className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
              style={metric === key ? { background: "#aeea00", color: "#062013" } : { background: "transparent", color: "#8a948f" }}>
              {label}
            </button>
          ))}
        </div>

        <Link href="/leagues" className="flex items-center justify-between rounded-xl px-4 py-3 mb-4 active:scale-[0.98] transition-transform"
          style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.3)" }}>
          <span className="font-display tracking-wide" style={{ fontSize: 16, color: "#aeea00" }}>🏟️ MY LEAGUES</span>
          <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>create or join a private board →</span>
        </Link>

        {loading ? (
          <div className="text-center py-10 font-body" style={{ color: "#8a948f" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
              {ready ? "NO WINS YET" : "LEADERBOARD COMING SOON"}
            </div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#8a948f" }}>
              {ready
                ? "Be the first on the board — win a ranked match."
                : "Cloud leaderboards activate once the season is live. Play Quick Matches now."}
            </p>
            <Link href="/38-0" className="inline-block mt-4 rounded-xl px-5 py-3 font-display tracking-wide"
              style={{ background: "#aeea00", color: "#062013", fontSize: 18 }}>
              BUILD YOUR XI →
            </Link>
          </div>
        ) : (
          /* Premier League–style table: Played, Won, Drawn, Lost, Points columns. */
          <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center px-3 py-2 font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 0.5, background: "rgba(255,255,255,0.03)" }}>
              <span style={{ width: 30, textAlign: "center" }}>#</span>
              <span className="flex-1 pl-2">TEAM</span>
              <span style={{ width: 26, textAlign: "center" }}>P</span>
              <span style={{ width: 26, textAlign: "center" }}>W</span>
              <span style={{ width: 26, textAlign: "center" }}>D</span>
              <span style={{ width: 26, textAlign: "center" }}>L</span>
              <span style={{ width: 38, textAlign: "center", color: "#c4ccc6" }}>PTS</span>
            </div>
            {rows.map((r) => {
              const isMe = user && r.user_id === user.id;
              const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
              const played = r.wins + r.draws + r.losses;
              return (
                <div key={r.user_id} className="flex items-center px-3 py-2.5"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: isMe ? "rgba(174,234,0,0.08)" : "transparent" }}>
                  <span className="font-display tabular-nums" style={{ width: 30, textAlign: "center", fontSize: medal ? 16 : 15, color: r.rank === 1 ? "#ffb800" : r.rank <= 3 ? "#c4ccc6" : "#8a948f" }}>
                    {medal ?? r.rank}
                  </span>
                  <div className="flex-1 min-w-0 pl-2">
                    <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                      {r.display_name}{isMe ? " (you)" : ""}
                    </div>
                  </div>
                  <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#c4ccc6" }}>{played}</span>
                  <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#aeea00" }}>{r.wins}</span>
                  <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#ffb800" }}>{r.draws}</span>
                  <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#ff4757" }}>{r.losses}</span>
                  <span className="font-display tabular-nums" style={{ width: 38, textAlign: "center", fontSize: 16, color: "#fff" }}>{r.points}</span>
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

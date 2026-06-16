"use client";

/**
 * /38-0/wc/board — World Cup Daily season leaderboard.
 *
 * Aggregates ranked daily runs across the WC2026 window (get_wc_daily_leaderboard via
 * /api/draft/wc/leaderboard). Ranks by total points (3W+1D, computed only to sort) and
 * shows each player's season W / D / L / points. Its own board — separate from H2H/Rank.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";

const ACCENT = "#ffb800";

type Row = {
  user_id: string; display_name: string; avatar_url: string | null;
  wins: number; draws: number; losses: number; points: number; days: number; rank: number;
  comments?: number;
};

export default function WorldCupBoard() {
  const { user } = useUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/draft/wc/leaderboard")
      .then((r) => r.json())
      .then((d) => { if (alive) setRows(d.rows ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      {/* Sticky back bar — a real pill button that stays put however far down you scroll. */}
      <div className="sticky top-0 z-30" style={{ background: "rgba(10,10,15,0.82)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingTop: "calc(env(safe-area-inset-top,0px) + 10px)", paddingBottom: 10 }}>
        <div className="max-w-lg mx-auto px-5">
          <Link href="/38-0/wc" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-display tracking-wide active:scale-95 transition-transform"
            style={{ background: "rgba(255,184,0,0.14)", border: "1px solid rgba(255,184,0,0.45)", color: ACCENT, fontSize: 14 }}>
            ← World Cup
          </Link>
        </div>
      </div>
      <div className="max-w-lg mx-auto px-5 pt-5">
        <h1 className="font-display tracking-wide" style={{ fontSize: 32, color: ACCENT }}>WORLD CUP <span style={{ color: "#fff" }}>SEASON</span></h1>
        <p className="mt-1 text-sm" style={{ color: "#9a9ab0" }}>
          One ranked run a day through the World Cup. Closest to a perfect 8-0-0 across the tournament wins.
        </p>

        <Link href="/38-0/wc?daily=1" className="mt-5 block text-center rounded-2xl py-3.5 font-display tracking-wide active:scale-[0.99] transition-transform"
          style={{ background: ACCENT, color: "#1a1300", fontSize: 18 }}>
          ▶ PLAY TODAY&apos;S RUN
        </Link>

        <div className="mt-7">
          {loading ? (
            <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <span className="wcb-sk" style={{ width: 18, height: 14, borderRadius: 4 }} />
                  <span className="wcb-sk flex-1" style={{ height: 14, borderRadius: 4, maxWidth: `${70 - i * 5}%` }} />
                  <span className="wcb-sk" style={{ width: 40, height: 14, borderRadius: 4 }} />
                </div>
              ))}
              <style>{`.wcb-sk{display:block;background:rgba(255,255,255,0.06);animation:wcbShimmer 1.1s ease-in-out infinite}@keyframes wcbShimmer{0%,100%{opacity:.45}50%{opacity:.95}}`}</style>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl px-4 py-6 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-body text-sm" style={{ color: "#8888aa" }}>No runs banked yet — play today&apos;s run to open the board.</p>
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center px-3 py-2 font-body" style={{ fontSize: 10, color: "#8888aa", letterSpacing: 0.5, background: "rgba(255,255,255,0.03)" }}>
                <span style={{ width: 28, textAlign: "center" }}>#</span>
                <span className="flex-1 pl-2">PLAYER</span>
                <span style={{ width: 24, textAlign: "center" }}>W</span>
                <span style={{ width: 24, textAlign: "center" }}>D</span>
                <span style={{ width: 24, textAlign: "center" }}>L</span>
                <span style={{ width: 40, textAlign: "center", color: "#cfcfe6" }}>PTS</span>
              </div>
              {rows.map((r) => {
                const isMe = user && r.user_id === user.id;
                const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
                return (
                  <Link key={r.user_id} href={`/38-0/wc/board/${r.user_id}`}
                    className="flex items-center px-3 py-2.5 transition-colors active:opacity-80"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: isMe ? "rgba(255,184,0,0.08)" : "transparent" }}>
                    <span className="font-display tabular-nums" style={{ width: 28, textAlign: "center", fontSize: medal ? 15 : 14, color: r.rank === 1 ? ACCENT : r.rank <= 3 ? "#cfcfe6" : "#8888aa" }}>
                      {medal ?? r.rank}
                    </span>
                    <div className="min-w-0 pl-2" style={{ maxWidth: "46%" }}>
                      <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{r.display_name}{isMe ? " (you)" : ""}</div>
                      <div className="font-body" style={{ fontSize: 10, color: "#6a6a82" }}>{r.days} {r.days === 1 ? "day" : "days"} played · view drafts →</div>
                    </div>
                    {/* Comment indicator — centred in the gap so it's obvious which entries have comments */}
                    <div className="flex-1 flex items-center justify-center px-1">
                      {!!r.comments && (
                        <span className="font-body inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ fontSize: 11, color: "#9fd8d8", background: "rgba(0,216,192,0.14)", border: "1px solid rgba(0,216,192,0.34)" }}>💬 {r.comments}</span>
                      )}
                    </div>
                    <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: "#00ff87" }}>{r.wins}</span>
                    <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: ACCENT }}>{r.draws}</span>
                    <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: "#ff4757" }}>{r.losses}</span>
                    <span className="font-display tabular-nums" style={{ width: 40, textAlign: "center", fontSize: 16, color: "#fff" }}>{r.points}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * RankRewardCard — the post-game reward moment.
 *
 * Mounts on a game-end screen, fetches the player's YourScore Rank
 * (get_yourscore_rank RPC — one currency: Knowledge + Match points) and diffs
 * it against the last snapshot cached on-device, so every finished Game shows:
 *   +points earned (always ≥0 — scores only climb),
 *   places gained (never shows a drop),
 *   their position, and the gap to the player directly above ("overtake X").
 * Renders nothing for guests or until the rank row arrives.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { positionBadge, positionColor, type RankRow } from "@/lib/rank";
import { AppMomentPrompt } from "@/components/app/AppMomentPrompt";

type Snapshot = { overall_score: number; overall_rank: number };

const KEY = (userId: string) => `ys:lastRank:v2:${userId}`;

export function RankRewardCard() {
  const [row, setRow] = useState<RankRow | null>(null);
  const [gained, setGained] = useState<{ points: number; places: number } | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    let cancelled = false;
    // One server call (see /api/rank/me): auth + the get_yourscore_rank RPC run
    // co-located with the DB, instead of two sequential client→eu-central-1
    // round-trips (~2s) after every game. userId comes back on the row itself.
    fetch("/api/rank/me")
      .then((r) => r.json())
      .then(({ row: cur }: { row: RankRow | null }) => {
        if (!cur || cancelled) return;
        const userId = cur.user_id;

        let prev: Snapshot | null = null;
        try { prev = JSON.parse(localStorage.getItem(KEY(userId)) ?? "null"); } catch { /* ignore */ }
        try {
          localStorage.setItem(KEY(userId), JSON.stringify({
            overall_score: cur.overall_score, overall_rank: cur.overall_rank,
          } satisfies Snapshot));
        } catch { /* storage blocked — deltas just won't show next time */ }

        setRow(cur);
        if (prev) {
          setGained({
            points: Math.max(0, cur.overall_score - prev.overall_score),
            places: Math.max(0, prev.overall_rank - cur.overall_rank),
          });
        }
      })
      .catch(() => { /* leave the card hidden on error */ });
    return () => { cancelled = true; };
  }, []);

  if (!row) return null;

  const pos = row.overall_rank;
  const badge = positionBadge(pos);
  const accent = positionColor(pos);
  const isTop = pos === 1;
  const gap = !isTop && row.ahead_points != null ? Math.max(1, row.ahead_points - row.overall_score) : null;
  // Catch-up bar: how close you are to the player above (their score = full bar).
  const chasePct = gap !== null && row.ahead_points ? Math.min(1, row.overall_score / row.ahead_points) : 1;

  // A "good moment": they just finished a game and earned points (so never on a
  // brand-new player's first game — gained needs a prior snapshot). This is when
  // we ask a native user to rate, or nudge a web iPhone user to download.
  const success = !!(gained && gained.points > 0);

  return (
    <>
    <Link href="/leaderboard" className="block rounded-2xl px-4 py-3.5 transition-opacity hover:opacity-90"
      style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.10), rgba(174,234,0,0.05))", border: `1px solid ${accent}33` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg flex-shrink-0">{badge?.emoji ?? "🏅"}</span>
          <div className="min-w-0">
            <p className="font-display text-xl leading-none" style={{ color: accent === "#8a948f" ? "#ffffff" : accent }}>
              #{pos.toLocaleString()}
              <span className="font-body text-xs ml-1.5" style={{ color: "#8a948f" }}>{row.overall_score.toLocaleString()} pts</span>
            </p>
            <p className="font-body text-[10px] uppercase tracking-widest mt-1" style={{ color: "#586058" }}>
              YourScore leaderboard{badge ? ` · ${badge.label}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {gained && gained.points > 0 && (
            <p className="font-body text-sm font-bold" style={{ color: "#aeea00" }}>+{gained.points.toLocaleString()} pts</p>
          )}
          {gained && gained.places > 0 && (
            <p className="font-body text-xs" style={{ color: "#aeea00" }}>▲ {gained.places.toLocaleString()} place{gained.places === 1 ? "" : "s"}</p>
          )}
          {(!gained || (gained.points === 0 && gained.places === 0)) && (
            <p className="font-body text-xs" style={{ color: "#8a948f" }}>Keep playing to climb</p>
          )}
        </div>
      </div>
      <div className="mt-3">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.max(4, chasePct * 100)}%`, background: `linear-gradient(90deg, ${accent}66, ${accent})`, transition: "width 0.6s ease-out" }} />
        </div>
        <p className="font-body text-[10px] mt-1.5" style={{ color: "#586058" }}>
          {isTop
            ? "👑 Top of the table. Defend it"
            : gap !== null
              ? `${gap.toLocaleString()} pts behind ${row.ahead_name ?? "the player above"} (#${pos - 1}). Overtake them`
              : "Every game adds points. Keep climbing"}
        </p>
      </div>
    </Link>
    <AppMomentPrompt success={success} />
    </>
  );
}

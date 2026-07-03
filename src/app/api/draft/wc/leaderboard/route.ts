import { NextResponse } from "next/server";
import { createWcDb } from "@/lib/draft/wc-server";
import { WC_SEASON_START, WC_SEASON_END } from "@/lib/draft/wc";

// World Cup Daily season leaderboard — aggregate W/D/L + points over ranked runs in the
// WC2026 window (get_wc_daily_leaderboard). Public read; fails soft to an empty board if
// the migration isn't applied yet, so the page never errors.

export const revalidate = 60;

export async function GET() {
  try {
    const db = createWcDb();
    const { data, error } = await db.rpc("get_wc_daily_leaderboard", {
      p_start: WC_SEASON_START,
      p_end: WC_SEASON_END,
      p_limit: 100000, // the WHOLE table, not just the top 100 (also lets a player find their
                       // own standing on the finish screen however far down they are)
    });
    if (error) return NextResponse.json({ rows: [], ready: false });

    // Merge in each player's comment count so the board can show a 💬 badge (best-effort —
    // a missing comments migration just leaves the counts off).
    const counts = new Map<string, number>();
    try {
      const { data: cc } = await db.rpc("get_wc_comment_counts", { p_start: WC_SEASON_START, p_end: WC_SEASON_END });
      for (const r of (cc ?? []) as { user_id: string; comments: number }[]) counts.set(r.user_id, r.comments);
    } catch { /* leave badges off */ }
    // Top 300 only: the full table was a ~200KB JSON parse on every phone that
    // opened the board. Your own standing (however deep) comes from ./me.
    const rows = ((data ?? []) as { user_id: string }[]).slice(0, 300).map((r) => ({ ...r, comments: counts.get(r.user_id) ?? 0 }));
    return NextResponse.json({ rows, ready: true });
  } catch {
    return NextResponse.json({ rows: [], ready: false });
  }
}

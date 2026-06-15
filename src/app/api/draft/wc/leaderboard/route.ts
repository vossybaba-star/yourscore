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
      p_limit: 100,
    });
    if (error) return NextResponse.json({ rows: [], ready: false });
    return NextResponse.json({ rows: data ?? [], ready: true });
  } catch {
    return NextResponse.json({ rows: [], ready: false });
  }
}

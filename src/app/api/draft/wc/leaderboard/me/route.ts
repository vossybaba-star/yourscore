import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createWcDb } from "@/lib/draft/wc-server";
import { WC_SEASON_START, WC_SEASON_END } from "@/lib/draft/wc";

// The caller's own World Cup season standing — one row instead of the whole
// table. The board route serves the (cacheable) top 300; this dynamic route
// covers "where am I?" for players below the cut and the run finish screen.
export async function GET() {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ row: null });

    const db = createWcDb();
    const { data, error } = await db.rpc("get_wc_daily_leaderboard", {
      p_start: WC_SEASON_START, p_end: WC_SEASON_END, p_limit: 100000,
    });
    if (error) return NextResponse.json({ row: null });
    const row = ((data ?? []) as { user_id: string }[]).find((r) => r.user_id === user.id) ?? null;
    return NextResponse.json({ row });
  } catch {
    return NextResponse.json({ row: null });
  }
}

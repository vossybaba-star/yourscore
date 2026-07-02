import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Global YourScore rank board (top 100) — the same for every viewer. The
// /leaderboard page was calling the get_yourscore_leaderboard RPC directly from
// the client (Supabase eu-central-1) after hydration, a ~1s round-trip. Serve
// the global board from a Vercel edge-cached route so it lands in ~30-50ms.
// (The per-user "friends" board stays a direct client call — it's not shared.)
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export async function GET() {
  try {
    const db = createServiceClient();
    // Omit p_user_ids so the RPC uses its DEFAULT NULL = the full global board.
    const { data, error } = await db.rpc("get_yourscore_leaderboard", { p_user_ids: undefined, p_limit: 100 });
    if (error) return NextResponse.json({ rows: [] });
    return NextResponse.json({ rows: data ?? [] }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ rows: [] });
  }
}

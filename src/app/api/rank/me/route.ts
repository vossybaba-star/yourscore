import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The authenticated user's live YourScore rank, resolved server-side next to the
// DB (eu-central-1). The post-game RankRewardCard previously did TWO sequential
// client→eu-central-1 round-trips — auth.getUser() then the get_yourscore_rank
// RPC (~2s after a game) — this collapses them into a single client→origin call
// with auth + RPC co-located. NOT cached: the reward card must show the fresh,
// just-updated rank (and its rank-diff would break on stale data).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ row: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc("get_yourscore_rank", { p_user_id: user.id });
    return NextResponse.json({ row: data?.[0] ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ row: null });
  }
}

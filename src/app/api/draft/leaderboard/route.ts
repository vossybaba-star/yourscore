import { NextRequest, NextResponse } from "next/server";
import { createDraftDb, GLOBAL_LEAGUE } from "@/lib/draft/server";

// Public leaderboard read. metric=today (daily, resets 00:00 UTC) | all (all-time).
// league=<uuid> for a private league board; omitted = global. Fails soft (empty
// list) if the migration isn't applied yet, so the page never errors.

export async function GET(req: NextRequest) {
  const metric = req.nextUrl.searchParams.get("metric") === "today" ? "today" : "all";
  const league = req.nextUrl.searchParams.get("league");

  try {
    const db = createDraftDb();
    const { data, error } = await db.rpc("draft_leaderboard", {
      p_league_id: league ?? GLOBAL_LEAGUE,
      p_metric: metric,
      p_limit: 100,
    });
    if (error) return NextResponse.json({ rows: [], ready: false });
    return NextResponse.json({ rows: data ?? [], ready: true });
  } catch {
    return NextResponse.json({ rows: [], ready: false });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createDraftDb, GLOBAL_LEAGUE } from "@/lib/draft/server";
import { seedLeaderboardRows, type SeedRow } from "@/lib/draft/seedLeaderboard";
import { asLeague } from "@/lib/draft/types";

// Public leaderboard read. metric=today (daily, resets 00:00 UTC) | all (all-time).
// league=<uuid> for a private league board; omitted = global. Ranked by points
// (Win=3, Draw=1) via draft_leaderboard_points. Fails soft (empty list) if the
// migration isn't applied yet, so the page never errors.
//
// The GLOBAL board is padded with read-only "filler" profiles (seedLeaderboard) so
// a young ladder looks populated. Private league boards are NEVER padded — those
// are the user's real mates.

export async function GET(req: NextRequest) {
  const metric = req.nextUrl.searchParams.get("metric") === "today" ? "today" : "all";
  const league = req.nextUrl.searchParams.get("league");
  const competition = asLeague(req.nextUrl.searchParams.get("competition"));
  const isGlobal = !league || league === GLOBAL_LEAGUE;

  let real: SeedRow[] = [];
  try {
    const db = createDraftDb();
    const { data, error } = await db.rpc("draft_leaderboard_points", {
      p_league_id: league ?? GLOBAL_LEAGUE,
      p_metric: metric,
      p_limit: 100,
      p_competition: competition,
    });
    if (error && !isGlobal) return NextResponse.json({ rows: [], ready: false });
    real = (data ?? []) as SeedRow[];
  } catch {
    if (!isGlobal) return NextResponse.json({ rows: [], ready: false });
  }

  if (!isGlobal) return NextResponse.json({ rows: real, ready: true });

  // Global board: merge real players with filler profiles, then re-rank together.
  const realNames = new Set(real.map((r) => r.display_name.toLowerCase()));
  const filler = seedLeaderboardRows(metric, new Date().toISOString().slice(0, 10))
    .filter((s) => !realNames.has(s.display_name.toLowerCase()));
  const rows = [...real, ...filler]
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, 100)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return NextResponse.json({ rows, ready: true });
}

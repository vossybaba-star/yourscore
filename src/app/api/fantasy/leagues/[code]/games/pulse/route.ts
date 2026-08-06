import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../../_lib";
import { leagueGamesPulse } from "@/lib/fantasy/games";

/**
 * GET /api/fantasy/leagues/[code]/games/pulse — the League Hub module's and
 * the Games tab badge's shared, deliberately tiny fetch (Phase 4B/4A
 * follow-through): open challenges across the league, the viewer's own
 * action-required count, and a one-line caption off the most recent result.
 * Never the full GamesOverview (no leaderboard, no card lists) — see
 * leagueGamesPulse's own doc in games.ts. Member-only, same gate the games
 * overview route uses.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("league-games-pulse", (db, userId) => leagueGamesPulse(db, userId, params.code));
}

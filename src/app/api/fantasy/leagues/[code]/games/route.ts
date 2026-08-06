import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { leagueGamesOverview } from "@/lib/fantasy/games";

/**
 * GET /api/fantasy/leagues/[code]/games — the league Games tab overview
 * (Phase 4A): what the viewer has to act on, what's open league-wide, recent
 * results, and the read-time leaderboard. Member-only (leagueGamesOverview's
 * own membership gate), same conventions as the members route.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("league-games", (db, userId) => leagueGamesOverview(db, userId, params.code));
}

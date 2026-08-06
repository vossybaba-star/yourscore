import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../../_lib";
import { leagueGamesHistory } from "@/lib/fantasy/games";

/**
 * GET /api/fantasy/leagues/[code]/games/history — completed challenge
 * results for LeagueHistoryView's flat "GAMES" block (Phase 4B). A separate
 * fetch from GET .../history rather than folding into leagueHistory
 * (leagues.ts): History there is strictly per-gameweek buckets and games.ts
 * already owns every other Games read (overview, pulse) — keeping this here
 * avoids a cross-file import between leagues.ts and games.ts for one block.
 * Member-only, same gate the games overview route uses.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("league-games-history", async (db, userId) => {
    const entries = await leagueGamesHistory(db, userId, params.code);
    return { entries };
  });
}

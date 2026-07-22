import { NextRequest, NextResponse } from "next/server";
import {
  clubsForSeason,
  defaultGameweek,
  halftimeAttemptsForGameweek,
  seasonForRound,
  supportersForSeason,
} from "@/lib/clubs/query";
import { gameweekClubTable } from "@/lib/clubs/table";

/**
 * GET /api/clubs/table?gw=<round_name> — PUBLIC, no auth needed.
 *
 * Defaults to the most recent gameweek that has fully kicked off (see
 * defaultGameweek() in query.ts for the exact "completed" definition — an
 * interpretation of an underspecified brief term, flagged in the session
 * report). Never materialised: every field here is recomputed from
 * quiz_attempts + halftime_releases + club_supporters on every request.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const gwParam = req.nextUrl.searchParams.get("gw");

    let seasonId: number | null;
    let roundName: string | null;

    if (gwParam) {
      roundName = gwParam;
      seasonId = await seasonForRound(gwParam);
    } else {
      const def = await defaultGameweek();
      seasonId = def?.seasonId ?? null;
      roundName = def?.roundName ?? null;
    }

    if (seasonId == null || roundName == null) {
      return NextResponse.json({ gw: null, standings: [] }, { headers: noStore() });
    }

    const [clubs, supporters, attempts] = await Promise.all([
      clubsForSeason(seasonId),
      supportersForSeason(seasonId),
      halftimeAttemptsForGameweek(seasonId, roundName),
    ]);

    const standings = gameweekClubTable(supporters, attempts, clubs);

    return NextResponse.json({ gw: roundName, standings }, { headers: noStore() });
  } catch (err) {
    // A failure must NOT masquerade as "no gameweek yet". Returning an empty
    // 200 here is how a broken table renders as a quietly absent one — the UI
    // self-hides on empty, so nobody ever finds out. (This bit us for real: a
    // 400 from a query made the whole leaderboard silently vanish.) 500 loudly.
    console.error("[clubs/table] failed", err);
    return NextResponse.json({ error: "Failed to build the club table" }, { status: 500 });
  }
}

function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

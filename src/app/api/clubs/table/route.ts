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
    console.error("[clubs/table] failed", err);
    return NextResponse.json({ gw: null, standings: [] }, { headers: noStore() });
  }
}

function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

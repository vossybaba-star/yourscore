/** POST /api/fantasy/challenges — send a league-mate challenge (createChallenge).
 *  GET  /api/fantasy/challenges?with=<uuid>&league=<code> — the open (or most
 *  recent) challenge between the caller and `with`, for the MemberActionSheet
 *  chip's Challenge/Pending state. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { createChallenge, pairStatus } from "@/lib/fantasy/challenges";
import { HttpError } from "@/lib/fantasy/server";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("challenges-create", (db, userId) => createChallenge(db, userId, body));
}

export async function GET(req: NextRequest) {
  const opponentId = req.nextUrl.searchParams.get("with") ?? "";
  const leagueCode = req.nextUrl.searchParams.get("league");
  return withFantasyUser("challenges-pair-status", async (db, userId) => {
    if (!opponentId) throw new HttpError(400, "missing with");
    let leagueId: string | undefined;
    if (leagueCode) {
      const { data: league } = await db.from("fantasy_leagues")
        .select("id").eq("join_code", leagueCode.toUpperCase()).maybeSingle();
      leagueId = league?.id;
    }
    const challenge = await pairStatus(db, userId, opponentId, leagueId);
    return { challenge };
  });
}

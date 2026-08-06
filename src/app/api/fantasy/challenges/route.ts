/** POST /api/fantasy/challenges — send a league-mate challenge (createChallenge).
 *  GET  /api/fantasy/challenges?with=<uuid>&league=<code> — the open (or most
 *  recent) challenge between the caller and `with`, for the MemberActionSheet
 *  chip's Challenge/Pending state.
 *  GET  /api/fantasy/challenges?h2h=<uuid> — (Phase 3E) which league-mate
 *  challenge, if any, a given h2h_challenges id belongs to — the h2h results
 *  page's "Back to the league" action. See challengeByH2h's own doc. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { createChallenge, pairStatus, challengeByH2h } from "@/lib/fantasy/challenges";
import { HttpError } from "@/lib/fantasy/server";
import { rateLimitDistributed } from "@/lib/ratelimit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("challenges-create", async (db, userId) => {
    // Tighter and longer-windowed than withFantasyUser's own 30/min op limit
    // — a challenge (unlike most fantasy actions) reaches another person, so
    // it gets its own hourly cap on top.
    const { ok } = await rateLimitDistributed(`challenge-create:${userId}`, 10, 3_600_000);
    if (!ok) throw new HttpError(429, "Easy, friend. Give it a moment before the next challenge.");
    return createChallenge(db, userId, body);
  });
}

export async function GET(req: NextRequest) {
  const h2hId = req.nextUrl.searchParams.get("h2h");
  if (h2hId) {
    return withFantasyUser("challenges-by-h2h", (db, userId) => challengeByH2h(db, userId, h2hId));
  }

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

    // Phase 3B — MemberActionSheet's chip needs "who's played" for a duel
    // (its awaiting_opponent/"Your turn" branch), which pairStatus's raw row
    // doesn't carry. Minimal extension rather than a hydrated ChallengeCardData
    // (challengeCardsFor) — the chip has no use for names/avatars it already
    // has from `member`.
    let challengerDone = false;
    let opponentDone = false;
    if (challenge && challenge.game_type === "quiz_duel" && challenge.result_id) {
      const { data: attempts } = await db.from("h2h_duel_attempts")
        .select("user_id").eq("h2h_id", challenge.result_id);
      const doneUsers = new Set(((attempts ?? []) as { user_id: string }[]).map((a) => a.user_id));
      challengerDone = doneUsers.has(challenge.challenger_id);
      opponentDone = doneUsers.has(challenge.opponent_id);
    }

    return { challenge, challengerDone, opponentDone };
  });
}

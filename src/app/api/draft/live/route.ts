import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, GLOBAL_LEAGUE } from "@/lib/draft/server";
import { createFriendMatch, joinByCode, queueOrPair, createBotMatch, leaveQueue,
  createLeagueChallenge, acceptChallenge, dismissChallenge, type MatchmakeOpts } from "@/lib/draft/live-server";

// Matchmaking entry point.
//   create      → open a friend lobby (returns a shareable code)
//   join        → claim the p2 seat in a friend lobby by code
//   queue       → poll the random queue: { matched, match } | { waiting: true }
//   bot         → bot fallback (call after waiting ~15-20s with no human)
//   cancelQueue → leave the queue
//   challenge   → open a directed league challenge { leagueId, opponentId }
//   accept      → accept a directed league challenge { matchId }
//   decline     → decline/cancel a directed league challenge { matchId }
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play live" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-live-mm:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; code?: string; leagueId?: string; ranked?: boolean; opponentId?: string; matchId?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : null;
  const ranked = body.ranked !== false; // ranked by default
  const opts: MatchmakeOpts = { ranked, leagueId: leagueId === GLOBAL_LEAGUE ? null : leagueId };
  const db = createDraftDb();

  try {
    switch (body.action) {
      case "create":
        return NextResponse.json({ match: await createFriendMatch(db, user.id, opts) });
      case "join":
        if (!body.code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
        return NextResponse.json({ match: await joinByCode(db, user.id, body.code) });
      case "queue":
        return NextResponse.json(await queueOrPair(db, user.id, opts));
      case "bot":
        return NextResponse.json({ match: await createBotMatch(db, user.id, opts) });
      case "cancelQueue":
        await leaveQueue(db, user.id);
        return NextResponse.json({ ok: true });
      case "challenge":
        if (!leagueId || !body.opponentId) return NextResponse.json({ error: "Missing league or opponent" }, { status: 400 });
        return NextResponse.json({ match: await createLeagueChallenge(db, user.id, leagueId, body.opponentId) });
      case "accept":
        if (!body.matchId) return NextResponse.json({ error: "Missing match" }, { status: 400 });
        return NextResponse.json({ match: await acceptChallenge(db, user.id, body.matchId) });
      case "decline":
        if (!body.matchId) return NextResponse.json({ error: "Missing match" }, { status: 400 });
        await dismissChallenge(db, user.id, body.matchId);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

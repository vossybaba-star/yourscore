import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, GLOBAL_LEAGUE, type TeamSnapshot } from "@/lib/draft/server";
import { creditResult, applyTeamStreak } from "@/lib/draft/live-server";
import { settleStalePens, type PensState } from "@/lib/draft/pens-resolve";
import { resolveMatch, flipReport } from "@/lib/draft/live-score";
import { asLeague, type Formation, type PlacedPlayer, type Projected } from "@/lib/draft/types";
import { createServiceClient } from "@/lib/supabase/service";
import { sendH2HResultEmail } from "@/lib/email/senders";
// Vercel data cache pins service-role GETs (constant cache key) — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

// GET: show a friend challenge (challenger's snapshotted XI) so a friend can size
// it up before accepting. POST: the friend resolves it with their own active XI.

function expired(ts: string | null): boolean {
  return !!ts && new Date(ts).getTime() < Date.now();
}

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const code = (params.code ?? "").toUpperCase();
  try {
    const db = createDraftDb();
    const { data: ch, error } = await db
      .from("draft_challenges")
      .select("challenger_id, challenger_name, challenger_team, challenger_strength, status, expires_at")
      .eq("code", code)
      .maybeSingle();
    if (error) return NextResponse.json({ ready: false });
    if (!ch) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

    const snap = ch.challenger_team as unknown as TeamSnapshot;
    return NextResponse.json({
      ready: true,
      challengerId: ch.challenger_id,
      challengerName: ch.challenger_name,
      strength: Number(ch.challenger_strength),
      formation: snap.formation,
      squad: snap.squad,
      projected: snap.projected,
      status: ch.status,
      expired: expired(ch.expires_at),
    });
  } catch {
    return NextResponse.json({ ready: false });
  }
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to accept" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-accept:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const code = (params.code ?? "").toUpperCase();
  const db = createDraftDb();

  const { data: ch } = await db
    .from("draft_challenges")
    .select("id, code, challenger_id, challenger_name, challenger_team, challenger_strength, league_id, status, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!ch) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  if (ch.status !== "open") return NextResponse.json({ error: "Challenge already played" }, { status: 409 });
  if (expired(ch.expires_at)) return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
  if (ch.challenger_id === user.id) return NextResponse.json({ error: "That's your own challenge" }, { status: 400 });

  // The friend must have a saved, active XI in the challenge's competition.
  const competition = asLeague((ch as { competition?: string }).competition);
  const { data: mine } = await db
    .from("draft_teams")
    .select("display_name, formation, squad, strength_rating, projected, status")
    .eq("user_id", user.id)
    .eq("competition", competition)
    .maybeSingle();
  if (!mine) return NextResponse.json({ error: "Save your team first" }, { status: 400 });

  const challengerSnap = ch.challenger_team as unknown as TeamSnapshot;
  const mySide: TeamSnapshot = {
    name: mine.display_name ?? "You",
    formation: mine.formation as Formation,
    squad: mine.squad as unknown as PlacedPlayer[],
    strength: Number(mine.strength_rating),
    projected: mine.projected as unknown as Projected,
  };

  // Any shootout the accepter walked away from settles first (see pens-resolve).
  await settleStalePens(db, user.id);

  let matchId = crypto.randomUUID();
  // Resolve challenger-first (side a = challenger) so the stored report/goals align
  // with the challenger_* columns and the public match page. The accepter is side b.
  let res = resolveMatch(challengerSnap.squad, mySide.squad, matchId, { allowDraw: true });
  // Dev-only: force a level 90' (seed search — the engine itself is never hooked).
  if (process.env.NODE_ENV === "development" && req.nextUrl.searchParams.get("forceLevel") === "1") {
    for (let i = 0; i < 400 && res.outcome !== "draw"; i++) {
      matchId = crypto.randomUUID();
      res = resolveMatch(challengerSnap.squad, mySide.squad, matchId, { allowDraw: true });
    }
  }

  // ── Level after 90 → the accepter takes the shootout (side b). Credits, streaks
  // and the challenger email all wait for /api/draft/match/pens to settle it. The
  // challenge is still consumed now so the code can't be replayed.
  if (res.outcome === "draw") {
    const pensState: PensState = {
      userId: user.id, userSide: "b", flow: "challenge",
      shots: [], powers: [], dives: [], startedAt: new Date().toISOString(),
    };
    await db.from("draft_matches").insert({
      id: matchId,
      challenger_id: ch.challenger_id,
      opponent_id: user.id,
      challenger_team: challengerSnap as unknown as never,
      opponent_team: mySide as unknown as never,
      challenger_strength: challengerSnap.strength,
      opponent_strength: mySide.strength,
      winner_id: null,
      league_id: ch.league_id,
      competition,
      played_at: new Date().toISOString(),
      challenger_goals: res.goals.a,
      opponent_goals: res.goals.b,
      detail: { outcome: "pens_pending", single: true, pens: null, report: res.report, pensState } as unknown as never,
    });
    await db.from("draft_challenges").update({ status: "accepted", match_id: matchId }).eq("id", ch.id);
    return NextResponse.json({
      matchId, youWon: false, outcome: "draw", pensPending: true,
      goals: { you: res.goals.b, opp: res.goals.a }, pens: null,
      report: flipReport(res.report),
      you: mySide,
      opp: challengerSnap,
    });
  }

  const challengerWon = res.outcome === "A";
  const iWon = res.outcome === "B";
  const winnerId = challengerWon ? ch.challenger_id ?? GLOBAL_LEAGUE : iWon ? user.id : null;

  await db.from("draft_matches").insert({
    id: matchId,
    challenger_id: ch.challenger_id,
    opponent_id: user.id,
    challenger_team: challengerSnap as unknown as never,
    opponent_team: mySide as unknown as never,
    challenger_strength: challengerSnap.strength,
    opponent_strength: mySide.strength,
    winner_id: winnerId,
    league_id: ch.league_id,
    competition,
    played_at: new Date().toISOString(),
    challenger_goals: res.goals.a,
    opponent_goals: res.goals.b,
    detail: { outcome: res.outcome, single: true, pens: res.pens, report: res.report } as unknown as never,
  });

  // Credit W/D/L for both players (global + league board) and update both streaks.
  const myRes = iWon ? "win" : challengerWon ? "loss" : "draw";
  const chRes = challengerWon ? "win" : iWon ? "loss" : "draw";
  await creditResult(db, user.id, mySide.name, myRes, GLOBAL_LEAGUE, competition);
  if (ch.league_id) await creditResult(db, user.id, mySide.name, myRes, ch.league_id, competition);
  if (ch.challenger_id) {
    await creditResult(db, ch.challenger_id, challengerSnap.name, chRes, GLOBAL_LEAGUE, competition);
    if (ch.league_id) await creditResult(db, ch.challenger_id, challengerSnap.name, chRes, ch.league_id, competition);
  }
  await applyTeamStreak(db, user.id, myRes, competition);
  if (ch.challenger_id) await applyTeamStreak(db, ch.challenger_id, chRes, competition);

  await db.from("draft_challenges").update({ status: "accepted", match_id: matchId }).eq("id", ch.id);

  // Lifecycle 22: the challenger's team just played without them — send the result.
  if (ch.challenger_id) {
    const challengerId = ch.challenger_id;
    void (async () => {
      const svc = createServiceClient();
      const { data: u } = await svc.auth.admin.getUserById(challengerId).catch(() => ({ data: null }));
      const challengerEmail = u?.user?.email;
      if (!challengerEmail) return;
      await sendH2HResultEmail({
        challengerUserId: challengerId,
        challengerEmail,
        opponentName: mySide.name,
        teamName: challengerSnap.name,
        myScore: res.goals.a,   // challenger = side a
        oppScore: res.goals.b,
        matchId,
      });
    })().catch(() => {});
  }

  // Return everything from the accepter's POV (you = side b), flipping the report.
  return NextResponse.json({
    matchId,
    youWon: iWon,
    outcome: iWon ? "you" : challengerWon ? "opp" : "draw",
    goals: { you: res.goals.b, opp: res.goals.a },
    pens: res.pens ? { you: res.pens.b, opp: res.pens.a } : null,
    report: flipReport(res.report),
    you: mySide,
    opp: challengerSnap,
  });
}

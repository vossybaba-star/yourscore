import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, GLOBAL_LEAGUE, type TeamSnapshot } from "@/lib/draft/server";
import { creditResult, applyTeamStreak } from "@/lib/draft/live-server";
import { resolveMatch, flipReport } from "@/lib/draft/live-score";
import type { Formation, PlacedPlayer, Projected } from "@/lib/draft/types";

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

  // The friend must have a saved, active XI of their own.
  const { data: mine } = await db
    .from("draft_teams")
    .select("display_name, formation, squad, strength_rating, projected, status")
    .eq("user_id", user.id)
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

  const matchId = crypto.randomUUID();
  // Resolve challenger-first (side a = challenger) so the stored report/goals align
  // with the challenger_* columns and the public match page. The accepter is side b.
  const res = resolveMatch(challengerSnap.squad, mySide.squad, matchId, { allowDraw: true });
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
    played_at: new Date().toISOString(),
    challenger_goals: res.goals.a,
    opponent_goals: res.goals.b,
    detail: { outcome: res.outcome, single: true, pens: res.pens, report: res.report } as unknown as never,
  });

  // Credit W/D/L for both players (global + league board) and update both streaks.
  const myRes = iWon ? "win" : challengerWon ? "loss" : "draw";
  const chRes = challengerWon ? "win" : iWon ? "loss" : "draw";
  await creditResult(db, user.id, mySide.name, myRes);
  if (ch.league_id) await creditResult(db, user.id, mySide.name, myRes, ch.league_id);
  if (ch.challenger_id) {
    await creditResult(db, ch.challenger_id, challengerSnap.name, chRes);
    if (ch.league_id) await creditResult(db, ch.challenger_id, challengerSnap.name, chRes, ch.league_id);
  }
  await applyTeamStreak(db, user.id, myRes);
  if (ch.challenger_id) await applyTeamStreak(db, ch.challenger_id, chRes);

  await db.from("draft_challenges").update({ status: "accepted", match_id: matchId }).eq("id", ch.id);

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

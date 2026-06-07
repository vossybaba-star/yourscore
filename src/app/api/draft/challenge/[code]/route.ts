import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, creditWin, applyTeamResult, GLOBAL_LEAGUE, type TeamSnapshot } from "@/lib/draft/server";
import { resolveH2H, seededRng } from "@/lib/draft/score";
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
  if (mine.status === "stale") return NextResponse.json({ error: "Your team is stale — rebuild first" }, { status: 409 });

  const challengerSnap = ch.challenger_team as unknown as TeamSnapshot;
  const mySide: TeamSnapshot = {
    name: mine.display_name ?? "You",
    formation: mine.formation as Formation,
    squad: mine.squad as unknown as PlacedPlayer[],
    strength: Number(mine.strength_rating),
    projected: mine.projected as unknown as Projected,
  };

  const matchId = crypto.randomUUID();
  // "A" = the accepting friend.
  const iWon = resolveH2H(mySide.strength, challengerSnap.strength, seededRng(matchId)) === "A";
  const margin = Math.abs(Math.round((mySide.strength - challengerSnap.strength) * 10) / 10);
  const winnerId = iWon ? user.id : ch.challenger_id ?? GLOBAL_LEAGUE;

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
  });

  // Credit the winner (global + league board). Apply win/loss to both live teams.
  if (iWon) {
    await creditWin(db, user.id, mySide.name);
    if (ch.league_id) await creditWin(db, user.id, mySide.name, ch.league_id);
  } else if (ch.challenger_id) {
    await creditWin(db, ch.challenger_id, challengerSnap.name);
    if (ch.league_id) await creditWin(db, ch.challenger_id, challengerSnap.name, ch.league_id);
  }
  await applyTeamResult(db, user.id, iWon);
  if (ch.challenger_id) await applyTeamResult(db, ch.challenger_id, !iWon);

  await db.from("draft_challenges").update({ status: "accepted", match_id: matchId }).eq("id", ch.id);

  return NextResponse.json({
    matchId,
    youWon: iWon,
    margin,
    you: mySide,
    opp: challengerSnap,
  });
}

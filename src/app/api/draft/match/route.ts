import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, creditWin, GLOBAL_LEAGUE } from "@/lib/draft/server";
import { resolveH2H, seededRng } from "@/lib/draft/score";
import { makeOpponent } from "@/lib/draft/opponent";
import type { Formation, PlacedPlayer, Projected } from "@/lib/draft/types";

// Ranked single-game H2H. The signed-in challenger's saved active XI is matched
// against a random active opponent (optionally within a league), or a bot if none
// is available. Server-authoritative: resolution is a seeded function of the new
// match id; both XIs are snapshotted; the winner's standings are credited; a
// challenger loss marks their team stale (rebuild required). Mirrors the
// stale-team anti-griefing rule — only active teams are selectable as opponents.

type TeamSide = {
  name: string;
  formation: Formation;
  squad: PlacedPlayer[];
  strength: number;
  projected: Projected | null;
};

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play ranked" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-match:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { leagueId?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body optional */
  }
  const leagueId = typeof body.leagueId === "string" ? body.leagueId : null;

  const db = createDraftDb();

  // Challenger must have a saved, active (non-stale) team.
  const { data: me } = await db
    .from("draft_teams")
    .select("user_id, display_name, formation, squad, strength_rating, projected, status, win_streak")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "Save a team first" }, { status: 400 });
  if (me.status === "stale") {
    return NextResponse.json({ error: "Your team is stale — rebuild to play" }, { status: 409 });
  }

  // Candidate opponents: active teams that aren't the challenger's. Within a league,
  // restrict to its members. Pick one at random from a capped sample.
  let memberIds: string[] | null = null;
  if (leagueId) {
    const { data: members } = await db
      .from("draft_league_members")
      .select("user_id")
      .eq("league_id", leagueId);
    memberIds = (members ?? []).map((m) => m.user_id).filter((id) => id !== user.id);
    if (memberIds.length === 0) memberIds = ["__none__"]; // force bot fallback below
  }

  let q = db
    .from("draft_teams")
    .select("user_id, display_name, formation, squad, strength_rating, projected")
    .eq("status", "active")
    .neq("user_id", user.id)
    .limit(50);
  if (memberIds) q = q.in("user_id", memberIds);
  const { data: candidates } = await q;

  const myStrength = Number(me.strength_rating);
  const matchId = crypto.randomUUID();

  // Build the opponent side — a real active team if available, else a bot.
  let opp: TeamSide;
  let opponentId: string | null;
  if (candidates && candidates.length > 0) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    opponentId = pick.user_id;
    opp = {
      name: pick.display_name ?? "Player",
      formation: pick.formation as Formation,
      squad: pick.squad as unknown as PlacedPlayer[],
      strength: Number(pick.strength_rating),
      projected: pick.projected as unknown as Projected,
    };
  } else {
    const bot = makeOpponent(me.formation as Formation, myStrength);
    opponentId = null;
    opp = {
      name: bot.name,
      formation: bot.team.formation,
      squad: bot.team.squad,
      strength: bot.team.strength,
      projected: bot.team.projected,
    };
  }

  const youWon = resolveH2H(myStrength, opp.strength, seededRng(matchId)) === "A";
  const margin = Math.abs(Math.round((myStrength - opp.strength) * 10) / 10);
  const winnerId = youWon ? user.id : opponentId ?? GLOBAL_LEAGUE; // sentinel = bot win

  const meSide: TeamSide = {
    name: me.display_name ?? "You",
    formation: me.formation as Formation,
    squad: me.squad as unknown as PlacedPlayer[],
    strength: myStrength,
    projected: me.projected as unknown as Projected,
  };

  // Snapshot the match (both XIs frozen so later edits can't rewrite history).
  await db.from("draft_matches").insert({
    id: matchId,
    challenger_id: user.id,
    opponent_id: opponentId,
    challenger_team: meSide as unknown as never,
    opponent_team: opp as unknown as never,
    challenger_strength: myStrength,
    opponent_strength: opp.strength,
    winner_id: winnerId,
    league_id: leagueId,
    played_at: new Date().toISOString(),
  });

  // Credit the winner's standings (bots don't rank). Global board always; league
  // board too when the match was played inside a league.
  if (youWon) {
    await creditWin(db, user.id, meSide.name);
    if (leagueId) await creditWin(db, user.id, meSide.name, leagueId);
  } else if (opponentId) {
    await creditWin(db, opponentId, opp.name);
    if (leagueId) await creditWin(db, opponentId, opp.name, leagueId);
  }

  // Apply the loop to the challenger's team: win → streak up, stays active (the
  // client unlocks the one earned swap); loss → stale (rebuild required).
  await db
    .from("draft_teams")
    .update({
      win_streak: youWon ? (me.win_streak ?? 0) + 1 : 0,
      status: youWon ? "active" : "stale",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  return NextResponse.json({
    matchId,
    youWon,
    margin,
    winStreak: youWon ? (me.win_streak ?? 0) + 1 : 0,
    you: { name: meSide.name, formation: meSide.formation, squad: meSide.squad, strength: meSide.strength, projected: meSide.projected },
    opp: { name: opp.name, formation: opp.formation, squad: opp.squad, strength: opp.strength, projected: opp.projected },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, creditWin, applyTeamResult, GLOBAL_LEAGUE } from "@/lib/draft/server";
import { resolveH2H, seededRng } from "@/lib/draft/score";
import { seededBot } from "@/lib/draft/opponent";
import type { Formation, PlacedPlayer, Projected } from "@/lib/draft/types";

// Two-stage ranked H2H so players can preview the opponent and swap before kick-off:
//   stage "find"    → matchmake and RETURN the opponent (no DB write, no result).
//   stage "resolve" → resolve the (possibly-swapped) saved XI vs that opponent.
// Integrity: real opponents are always re-fetched server-side; bots are regenerated
// deterministically from the find-id (so the previewed bot == the played bot); the
// OUTCOME uses a fresh server-side seed at resolve, so it can't be pre-computed.

type TeamSide = { name: string; formation: Formation; squad: PlacedPlayer[]; strength: number; projected: Projected | null };

const sideFromRow = (r: { display_name: string | null; formation: string; squad: unknown; strength_rating: number; projected: unknown }): TeamSide => ({
  name: r.display_name ?? "Player",
  formation: r.formation as Formation,
  squad: r.squad as PlacedPlayer[],
  strength: Number(r.strength_rating),
  projected: r.projected as Projected,
});

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play ranked" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-match:${user.id}`, 40, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  // NOTE: league play is Live-H2H-only (see /api/draft/live + the league board).
  // This async path is global/quick H2H only and deliberately ignores any leagueId.
  let body: { stage?: string; opponentId?: string; findId?: string; botFormation?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }
  const stage = body.stage === "resolve" ? "resolve" : "find";
  const targetId = typeof body.opponentId === "string" ? body.opponentId : null;

  const db = createDraftDb();
  const { data: me } = await db
    .from("draft_teams")
    .select("user_id, display_name, formation, squad, strength_rating, projected, win_streak")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "Save a team first" }, { status: 400 });
  const meSide = sideFromRow(me);

  // Resolve a specific opponent id to its current active team.
  async function fetchActive(id: string): Promise<TeamSide | null> {
    const { data } = await db
      .from("draft_teams")
      .select("display_name, formation, squad, strength_rating, projected, status")
      .eq("user_id", id).eq("status", "active").maybeSingle();
    return data ? sideFromRow(data) : null;
  }

  // ── FIND: matchmake and return the opponent (no resolution) ─────────────────
  if (stage === "find") {
    if (targetId) {
      if (targetId === user.id) return NextResponse.json({ error: "Can't challenge yourself" }, { status: 400 });
      const opp = await fetchActive(targetId);
      if (!opp) return NextResponse.json({ error: "Opponent unavailable" }, { status: 409 });
      return NextResponse.json({ opponentId: targetId, opp, you: meSide });
    }

    // Random: any active team that isn't ours, else a bot.
    const { data: candidates } = await db
      .from("draft_teams").select("user_id, display_name, formation, squad, strength_rating, projected")
      .eq("status", "active").neq("user_id", user.id).limit(50);

    if (candidates && candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return NextResponse.json({ opponentId: pick.user_id, opp: sideFromRow(pick), you: meSide });
    }
    const findId = crypto.randomUUID();
    const bot = seededBot(me.formation as Formation, findId);
    return NextResponse.json({
      opponentId: null, findId, botFormation: me.formation,
      opp: { name: bot.name, formation: bot.team.formation, squad: bot.team.squad, strength: bot.team.strength, projected: bot.team.projected },
      you: meSide,
    });
  }

  // ── RESOLVE: play the (now possibly-swapped) saved XI vs that opponent ───────
  const opponentId = targetId;
  let opp: TeamSide | null = null;
  if (opponentId) {
    opp = await fetchActive(opponentId);
    if (!opp) return NextResponse.json({ error: "Opponent unavailable" }, { status: 409 });
  } else {
    if (!body.findId) return NextResponse.json({ error: "Missing match" }, { status: 400 });
    const bot = seededBot((body.botFormation as Formation) ?? (me.formation as Formation), body.findId);
    opp = { name: bot.name, formation: bot.team.formation, squad: bot.team.squad, strength: bot.team.strength, projected: bot.team.projected };
  }

  const myStrength = meSide.strength;
  const matchId = crypto.randomUUID();                         // fresh — outcome can't be pre-computed
  const youWon = resolveH2H(myStrength, opp.strength, seededRng(matchId)) === "A";
  const margin = Math.abs(Math.round((myStrength - opp.strength) * 10) / 10);
  const winnerId = youWon ? user.id : opponentId ?? GLOBAL_LEAGUE;

  await db.from("draft_matches").insert({
    id: matchId, challenger_id: user.id, opponent_id: opponentId,
    challenger_team: meSide as unknown as never, opponent_team: opp as unknown as never,
    challenger_strength: myStrength, opponent_strength: opp.strength,
    winner_id: winnerId, league_id: null, played_at: new Date().toISOString(),
  });

  if (youWon) {
    await creditWin(db, user.id, meSide.name);
  } else if (opponentId) {
    await creditWin(db, opponentId, opp.name);
  }
  await applyTeamResult(db, user.id, youWon);

  return NextResponse.json({
    matchId, youWon, margin,
    you: meSide,
    opp: { name: opp.name, formation: opp.formation, squad: opp.squad, strength: opp.strength, projected: opp.projected },
  });
}

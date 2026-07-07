import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, genJoinCode, type TeamSnapshot } from "@/lib/draft/server";
import { asLeague, type Formation, type PlacedPlayer, type Projected } from "@/lib/draft/types";

// Create a friend challenge: snapshot the signed-in player's current active XI and
// mint a share code. A friend opens /draft/challenge/<code> and resolves it with
// their own XI whenever (async). Mirrors the spec's share-code friend flow.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to challenge a friend" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-challenge:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { leagueId?: string; competition?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }
  const leagueId = typeof body.leagueId === "string" ? body.leagueId : null;
  const competition = asLeague(body.competition);

  const db = createDraftDb();
  const { data: me, error: meErr } = await db
    .from("draft_teams")
    .select("display_name, formation, squad, strength_rating, projected, status")
    .eq("user_id", user.id)
    .eq("competition", competition)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: "Challenges not live yet" }, { status: 503 });
  if (!me) return NextResponse.json({ error: "Save a team first" }, { status: 400 });

  const snapshot: TeamSnapshot = {
    name: me.display_name ?? "A challenger",
    formation: me.formation as Formation,
    squad: me.squad as unknown as PlacedPlayer[],
    strength: Number(me.strength_rating),
    projected: me.projected as unknown as Projected,
  };

  let code: string | null = null;
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = genJoinCode();
    const { error } = await db.from("draft_challenges").insert({
      code: candidate,
      challenger_id: user.id,
      challenger_name: snapshot.name,
      challenger_team: snapshot as unknown as never,
      challenger_strength: snapshot.strength,
      league_id: leagueId,
      competition,
    });
    if (!error) code = candidate;
    else if (error.code !== "23505") {
      return NextResponse.json({ error: "Could not create challenge" }, { status: 500 });
    }
  }
  if (!code) return NextResponse.json({ error: "Could not create challenge" }, { status: 500 });

  // NOTE: the "first H2H challenge sent" lifecycle email (18-first-38-h2h) was
  // deliberately discarded — it only confirmed an action the user just took in-app,
  // where the code + share sheet are already in front of them. See the H2H *result*
  // email (22-h2h-result), which fires when the challenge is actually played.

  return NextResponse.json({ code });
}

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { validateAndScore } from "@/lib/draft/server";
import { simulateSeason } from "@/lib/draft/season";
import { leagueOpponents } from "@/lib/draft/pool";
import { asLeague } from "@/lib/draft/types";

// Verified 38-0 season records — the "closest to 38-0" leaderboard.
//
//   POST { league, formation, squad } → server re-validates the XI, recomputes the
//        seed from the squad and RE-RUNS the deterministic season sim. The client's
//        claimed result is never read, let alone trusted — that's the ✓.
//   GET  ?competition=PL → { seasons, wc, mine } — best-per-user boards (season +
//        closest-to-8-0 World Cup) and, when signed in, the caller's own bests.
//
// Fails soft (empty boards / clear error) before migration 29 is applied.

// The new table + RPCs postdate the generated DB types — untyped client until regen.
const recordsDb = (): SupabaseClient => createServiceClient() as unknown as SupabaseClient;

/** Same construction as local.ts seasonSeed: the sorted XI ids — one record per distinct XI. */
const seedOf = (ids: string[]): string => [...ids].sort().join("|");

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to enter the leaderboard" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-season-record:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { league?: unknown; formation?: unknown; squad?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const league = asLeague(typeof body.league === "string" ? body.league : null);
  let team;
  try {
    team = validateAndScore(body.formation, body.squad);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid team" }, { status: 400 });
  }

  // Authoritative re-simulation: seed and result both derive from the validated XI.
  const seed = seedOf(team.squad.map((p) => p.player_season_id));
  const result = simulateSeason(team.squad, team.formation, team.strength, seed, leagueOpponents(league));

  try {
    const db = recordsDb();
    const { data: profile } = await db.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    // One row per distinct XI — replaying the same squad is a no-op.
    await db.from("draft_season_records").upsert({
      user_id: user.id,
      display_name: profile?.display_name ?? "Player",
      competition: league,
      seed,
      wins: result.wins, draws: result.draws, losses: result.losses,
      points: result.points, league_pos: result.position,
      gf: result.gf, ga: result.ga,
      strength: team.strength,
      formation: team.formation,
      invincible: result.invincible,
    }, { onConflict: "user_id,seed", ignoreDuplicates: true });
    return NextResponse.json({ ok: true, wins: result.wins, draws: result.draws, losses: result.losses, invincible: result.invincible });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
}

export type SeasonBoardRow = {
  user_id: string; display_name: string; wins: number; draws: number; losses: number;
  points: number; league_pos: number; strength: number; invincible: boolean; created_at: string;
};
export type WcBoardRow = {
  user_id: string; display_name: string; nation: string; wins: number; games: number;
  status: string; created_at: string;
};

export async function GET(req: NextRequest) {
  const competition = asLeague(req.nextUrl.searchParams.get("competition"));

  let seasons: SeasonBoardRow[] = [];
  let wc: WcBoardRow[] = [];
  let mine: { season: SeasonBoardRow | null; wc: WcBoardRow | null } = { season: null, wc: null };

  try {
    const db = recordsDb();
    const [s, w] = await Promise.all([
      db.rpc("draft_season_leaderboard", { p_competition: competition, p_limit: 50 }),
      db.rpc("draft_wc_leaderboard", { p_limit: 50 }),
    ]);
    seasons = (s.data ?? []) as SeasonBoardRow[];
    wc = (w.data ?? []) as WcBoardRow[];

    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (user) {
      mine = {
        season: seasons.find((r) => r.user_id === user.id) ?? await myBestSeason(db, user.id, competition),
        wc: wc.find((r) => r.user_id === user.id) ?? null,
      };
    }
  } catch {
    // Pre-migration / transient DB issues: serve empty boards rather than erroring.
  }

  return NextResponse.json({ seasons, wc, mine });
}

/** The caller's best season even when outside the top 50. */
async function myBestSeason(db: SupabaseClient, userId: string, competition: string): Promise<SeasonBoardRow | null> {
  const { data } = await db
    .from("draft_season_records")
    .select("user_id, display_name, wins, draws, losses, points, league_pos, strength, invincible, created_at")
    .eq("user_id", userId).eq("competition", competition)
    .order("wins", { ascending: false }).order("points", { ascending: false })
    .limit(1).maybeSingle();
  return (data as SeasonBoardRow | null) ?? null;
}

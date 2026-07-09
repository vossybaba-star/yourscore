import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { validateNationLocked, validateWorld, newRunPlan, createWcDb, resolveEdition, WORLD_TEAM_NAME } from "@/lib/draft/wc-server";
import { verifyRankedDraft, rankedQuizScore, rankedQuizDetail, WC_DRAFT_FORMATION, type DraftPick } from "@/lib/draft/wc-draft";
import { ensurePool } from "@/lib/draft/pool";
import { sanitizeAcq } from "@/lib/analytics/acq-server";

// Start a World Cup Run: validate a nation-locked XI, plan the bracket (deterministic
// by a server seed), and create the run row. Server-authoritative — Strength is
// recomputed and every player is checked to be eligible for the chosen nation.

export async function POST(req: NextRequest) {
  await ensurePool(); // validate*() reads player ratings from the pool — load it server-side first
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-start:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; mode?: string; nation?: string; formation?: unknown; squad?: unknown; ranked?: boolean; answers?: unknown; picks?: unknown; catchup?: boolean; catchupDate?: string; acq?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (body.action !== "start") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  // Ranked = the daily competition (one locked go/edition, World XI only, season board).
  // Unranked = unlimited practice. The run is keyed to an EDITION (server-side, not the
  // calendar date): the current edition, or — for a `catchup` — ANY past edition the caller
  // selects from the open back-catalog (catchupDate). Omitting catchupDate falls back to the
  // immediately-previous edition for legacy callers. One-go per edition is enforced either way.
  const ranked = body.ranked === true;
  const catchup = ranked && body.catchup === true;
  const catchupDate = catchup && typeof body.catchupDate === "string" ? body.catchupDate : null;
  const db = createWcDb();
  const runDate = ranked ? await resolveEdition(db, catchup, catchupDate) : null;
  if (ranked && !runDate) return NextResponse.json({ error: "That catch-up edition isn't available." }, { status: 400 });
  const mode = ranked ? "world" : (body.mode === "world" ? "world" : "nation");
  // nation mode: locked to one nation; world mode: open draft, stored under "World XI".
  const nation = mode === "world" ? WORLD_TEAM_NAME : String(body.nation ?? "");
  let team;
  let quizScore: { correct: number; total: number } | null = null;
  let quizDetail: Array<Record<string, unknown>> | null = null;
  try {
    if (ranked) {
      // The ranked XI is built ENTIRELY server-side: replay the draft and verify every pick
      // was a legitimate, server-offered option for the band its (server-graded) answers
      // earned. A crafted/tampered squad fails here. (Practice stays client-built below.)
      const answers = (Array.isArray(body.answers) ? body.answers : []).map((v) => Number(v));
      const submitted = (Array.isArray(body.picks) ? body.picks : []).map((p) => {
        const o = p as { slot?: unknown; player_season_id?: unknown };
        return { slot: String(o?.slot ?? ""), player_season_id: String(o?.player_season_id ?? "") };
      }) as DraftPick[];
      const verified = verifyRankedDraft(runDate!, user.id, answers, submitted);
      if (!verified) return NextResponse.json({ error: "Ranked draft could not be verified — please play it through." }, { status: 400 });
      team = validateWorld(WC_DRAFT_FORMATION, verified);
      // Record how many of today's questions they got right (server-graded), plus the
      // per-question detail (migration 76) that feeds the Guru/hardest-question content.
      quizScore = rankedQuizScore(runDate!, answers);
      quizDetail = rankedQuizDetail(runDate!, answers);
    } else {
      team = mode === "world"
        ? validateWorld(body.formation, body.squad)
        : validateNationLocked(body.formation, body.squad, nation);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid team" }, { status: 400 });
  }

  // One ranked run per user per edition. Pre-check for a clean message; the unique index
  // (draft_wc_runs_daily_uidx) is the race-proof backstop.
  if (ranked) {
    const { data: existing } = await db
      .from("draft_wc_runs").select("id")
      .eq("user_id", user.id).eq("ranked", true).eq("run_date", runDate).maybeSingle();
    if (existing) return NextResponse.json({ error: "You've already played today's ranked run.", runId: existing.id, alreadyPlayed: true }, { status: 409 });
  }

  const seed = crypto.randomUUID();
  const plan = newRunPlan(mode, nation, seed);
  // First-touch acquisition source (client-stored ys:acq) — attributes this PLAY
  // to the platform/campaign that first brought the visitor. See migration 75.
  const acq = sanitizeAcq(body.acq);

  const { data, error } = await db
    .from("draft_wc_runs")
    .insert({
      user_id: user.id,
      mode,
      nation,
      seed,
      ranked,
      run_date: runDate,
      status: "active",
      stage: "group",
      stage_index: 0,
      formation: team.formation,
      squad: team.squad,
      strength: team.strength,
      quiz_correct: quizScore?.correct ?? null,
      quiz_total: quizScore?.total ?? null,
      quiz_answers: quizDetail,
      plan,
      group_played: 0,
      group_points: 0,
      upgrades_left: 0,
      source: acq.source,
      utm_source: acq.utm_source,
      utm_medium: acq.utm_medium,
      utm_campaign: acq.utm_campaign,
    })
    .select("id")
    .single();

  // A unique-violation here means a concurrent ranked start won the race — resolve to it.
  if (error && ranked && /duplicate|unique/i.test(error.message)) {
    const { data: ex } = await db.from("draft_wc_runs").select("id").eq("user_id", user.id).eq("ranked", true).eq("run_date", runDate).maybeSingle();
    if (ex) return NextResponse.json({ error: "You've already played today's ranked run.", runId: ex.id, alreadyPlayed: true }, { status: 409 });
  }
  if (error || !data) return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  return NextResponse.json({ runId: data.id, nation, strength: team.strength, plan, ranked });
}

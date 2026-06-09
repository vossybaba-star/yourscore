import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { rowToRun, currentFixture, resolveFixture, applyResult, createWcDb } from "@/lib/draft/wc-server";

// Play the run's current fixture. Server-authoritative: opponent and goals are
// resolved here (deterministic by the run seed), the match is recorded, and the run
// advances (next stage / elimination / champion).

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-play:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const runId = String(body.runId ?? "");

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const run = rowToRun(row);
  const fixture = currentFixture(run);
  if (!fixture) return NextResponse.json({ error: "Run is over" }, { status: 400 });

  const { result, oppStrength } = resolveFixture(run, fixture);
  const { match, patch } = applyResult(run, fixture, result, oppStrength);

  const { error: matchErr } = await db.from("draft_wc_matches").insert(match);
  if (matchErr) return NextResponse.json({ error: "Could not record match" }, { status: 500 });

  const { resolved, ...runPatch } = patch;
  const { error: runErr } = await db
    .from("draft_wc_runs")
    .update({ ...runPatch, updated_at: new Date().toISOString(), ...(resolved ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", runId)
    .eq("user_id", user.id);
  if (runErr) return NextResponse.json({ error: "Could not update run" }, { status: 500 });

  return NextResponse.json({
    match: {
      stage: fixture.stage,
      opponent: fixture.opponent,
      oppStrength,
      goals: { you: result.goals.a, opp: result.goals.b },
      pens: result.pens ? { you: result.pens.a, opp: result.pens.b } : null,
      outcome: result.outcome === "A" ? "win" : result.outcome === "B" ? "loss" : "draw",
      report: result.report,
    },
    run: { ...run, ...runPatch },
  });
}

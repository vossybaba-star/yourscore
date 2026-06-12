import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rowToRun, resolveStage, createWcDb, wcPensView, wcPensMeta, type WcPensState,
} from "@/lib/draft/wc-server";

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
  if (run.status !== "active") return NextResponse.json({ error: "Run is over" }, { status: 400 });
  // A shootout is still open — resume it (the stage can't replay underneath it).
  const openPens = (row as { pens_state?: WcPensState | null }).pens_state;
  if (openPens) {
    return NextResponse.json({
      pensPending: { ...wcPensMeta(run, openPens), view: wcPensView(run, openPens) },
      run,
    });
  }

  const stage = run.stage;
  const res = resolveStage(run);

  // A level knockout game pauses the stage — the user takes the shootout.
  if (res.pending) {
    if (res.rows.length > 0) {
      const { error: matchErr } = await db.from("draft_wc_matches").insert(res.rows);
      if (matchErr) return NextResponse.json({ error: "Could not record matches" }, { status: 500 });
    }
    const { error: runErr } = await db
      .from("draft_wc_runs")
      .update({ pens_state: res.pending, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("user_id", user.id);
    if (runErr) return NextResponse.json({ error: "Could not update run" }, { status: 500 });
    return NextResponse.json({
      pensPending: { ...wcPensMeta(run, res.pending), view: wcPensView(run, res.pending) },
      run,
    });
  }

  const { rows, reveals, patch } = res;

  const { error: matchErr } = await db.from("draft_wc_matches").insert(rows);
  if (matchErr) return NextResponse.json({ error: "Could not record matches" }, { status: 500 });

  const { resolved, ...runPatch } = patch;
  const { error: runErr } = await db
    .from("draft_wc_runs")
    .update({ ...runPatch, updated_at: new Date().toISOString(), ...(resolved ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", runId)
    .eq("user_id", user.id);
  if (runErr) return NextResponse.json({ error: "Could not update run" }, { status: 500 });

  const after = { ...run, ...runPatch };
  return NextResponse.json({
    stage,
    games: reveals,
    // Stage outcome for the reveal headline.
    result: after.status === "champion" ? "champion"
      : after.status === "eliminated" ? "eliminated"
      : "through",
    run: after,
  });
}

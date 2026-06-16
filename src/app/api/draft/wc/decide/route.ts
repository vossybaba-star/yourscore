import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { rowToRun, resolveStage, finalizeResolved, createWcDb } from "@/lib/draft/wc-server";

// Settle a drawn knockout tie / the qualification play-off with the player's quiz answer(s).
// Body: { runId, answers: { [gameIdx]: chosenOptionIndex } }. The server re-derives the same
// deterministic question(s) and grades them — the client never receives the correct answer.
// Re-running resolveStage with the answers reproduces the (deterministic) non-drawn games too,
// then records the stage and advances the run.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-decide:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string; answers?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const runId = String(body.runId ?? "");

  // Coerce the answers map to { idx:number -> choice:number }. A timeout is sent as -1
  // (never matches the correct index → counts as wrong).
  const answers: Record<number, number> = {};
  for (const [k, v] of Object.entries(body.answers ?? {})) {
    const idx = Number(k); const choice = Number(v);
    if (Number.isInteger(idx) && Number.isInteger(choice)) answers[idx] = choice;
  }

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const run = rowToRun(row);
  if (run.status !== "active") return NextResponse.json({ error: "Run is over" }, { status: 400 });

  const stage = run.stage;
  const res = resolveStage(run, answers);
  if (res.kind === "decider") {
    // Still missing answers for some drawn tie — ask again rather than persisting.
    return NextResponse.json({ awaitingDecider: true, stage, deciders: res.deciders, run });
  }

  try {
    return NextResponse.json(await finalizeResolved(db, user.id, run, stage, res, row.ranked === true));
  } catch {
    return NextResponse.json({ error: "Could not record the result" }, { status: 500 });
  }
}

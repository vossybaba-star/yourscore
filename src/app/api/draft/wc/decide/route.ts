import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rowToRun, settleByQuiz, finalizeResolved, createWcDb, type WcStageState,
} from "@/lib/draft/wc-server";

// The player chose the QUIZ to settle the current drawn tie / play-off.
// Body: { runId, answer: chosenOptionIndex } (a timeout is sent as -1 → never correct).
// The server re-derives the same deterministic decider question and grades it (the client
// never receives the correct index), settles the tie, then resumes the stage — which either
// finishes (records + advances) or pends the next tie's choice.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-decide:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string; answer?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const runId = String(body.runId ?? "");
  const answer = Number.isInteger(body.answer) ? (body.answer as number) : -1;

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const run = rowToRun(row);
  if (run.status !== "active") return NextResponse.json({ error: "Run is over" }, { status: 400 });

  const state = (row as { pens_state?: WcStageState | null }).pens_state;
  if (!state) return NextResponse.json({ error: "No tie to settle" }, { status: 409 });
  if (state.pens) return NextResponse.json({ error: "A shootout is already in progress" }, { status: 409 });

  const stage = run.stage;
  const res = settleByQuiz(run, state, answer);

  if (res.kind === "choice") {
    // The same stage pends another tie (the 2-game knockout round) — ask again.
    const { error } = await db.from("draft_wc_runs")
      .update({ pens_state: res.state, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Could not pause for the tie" }, { status: 500 });
    return NextResponse.json({ awaitingTie: true, stage, tie: res.tie, run });
  }

  try {
    return NextResponse.json(await finalizeResolved(db, user.id, run, stage, res, row.ranked === true));
  } catch {
    return NextResponse.json({ error: "Could not record the result" }, { status: 500 });
  }
}

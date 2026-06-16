import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rowToRun, startStage, finalizeResolved, createWcDb,
  wcPensView, wcPensMeta, tieFromState, type WcStageState,
} from "@/lib/draft/wc-server";

// Play the run's current fixture. Server-authoritative: opponent and goals are resolved
// here (deterministic by the run seed), the match is recorded, and the run advances.
// If a knockout finishes level (or it's the qualification play-off), nothing is written
// yet — we return the pending tie and the player chooses how to settle it: take penalties
// (/wc/pens then /wc/kick) or answer one more World Cup question (/wc/decide).

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

  const stage = run.stage;

  // A stage is already paused at a tie — resume it rather than replaying underneath.
  const open = (row as { pens_state?: WcStageState | null }).pens_state;
  if (open) {
    if (open.pens) {
      // The player chose penalties and is mid-shootout.
      return NextResponse.json({ pensPending: { ...wcPensMeta(run, open), view: wcPensView(run, open) }, run });
    }
    // Still waiting on the player's choice (pens or quiz).
    return NextResponse.json({ awaitingTie: true, stage, tie: tieFromState(run, open), run });
  }

  const res = startStage(run);

  if (res.kind === "choice") {
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

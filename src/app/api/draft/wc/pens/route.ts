import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rowToRun, beginPens, createWcDb, wcPensView, wcPensMeta, type WcStageState,
} from "@/lib/draft/wc-server";

// The player chose PENALTIES to settle the current drawn tie / play-off. Arms the shootout
// sub-state on the paused stage cursor; the kicks themselves come in via /wc/kick.
// Body: { runId }.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-pens:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const runId = String(body.runId ?? "");

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const run = rowToRun(row);
  if (run.status !== "active") return NextResponse.json({ error: "Run is over" }, { status: 400 });

  const state = (row as { pens_state?: WcStageState | null }).pens_state;
  if (!state) return NextResponse.json({ error: "No tie to settle" }, { status: 409 });

  // Idempotent: if a shootout is already armed, just return its current view.
  const armed = state.pens ? state : beginPens(state);
  if (!state.pens) {
    const { error } = await db.from("draft_wc_runs")
      .update({ pens_state: armed, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Could not start the shootout" }, { status: 500 });
  }

  return NextResponse.json({ pensPending: { ...wcPensMeta(run, armed), view: wcPensView(run, armed) }, run });
}

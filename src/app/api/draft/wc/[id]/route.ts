import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  rowToRun, revealOpponent, createWcDb, wcPensView, wcPensMeta, tieFromState, type WcStageState,
} from "@/lib/draft/wc-server";

// Full run state for initial load / reconnect: the run + its played matches + the
// fixture to play next (or null if the run is over) + any tie in progress (a pending
// choice between penalties and the quiz, or a shootout already underway).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", params.id).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { data: matches } = await db
    .from("draft_wc_matches")
    .select("*")
    .eq("run_id", params.id)
    .order("played_at", { ascending: true });

  const run = rowToRun(row);
  // A paused tie resumes exactly where the user left it: mid-shootout, or still
  // waiting on the choice between penalties and the quiz.
  const state = (row as { pens_state?: WcStageState | null }).pens_state ?? null;
  const pensPending = state?.pens ? { ...wcPensMeta(run, state), view: wcPensView(run, state) } : null;
  const pendingTie = state && !state.pens ? tieFromState(run, state) : null;
  return NextResponse.json({ run, matches: matches ?? [], opponent: revealOpponent(run), pensPending, pendingTie });
}

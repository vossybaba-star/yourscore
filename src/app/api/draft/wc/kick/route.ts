import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rowToRun, createWcDb, resumeAfterPens, finalizeResolved,
  wcPensKicks, wcPensView, wcPensMeta, type WcStageState,
} from "@/lib/draft/wc-server";
import { shootoutStatus, type PenPower, type PenZone } from "@/lib/draft/pens";
import { ensurePool } from "@/lib/draft/pool";

const POWERS = ["under", "good", "perfect", "over"];

// One action in a World Cup knockout shootout: { runId, action: "shot"|"dive", zone }.
// You shoot your kicks and dive against the CPU's, alternating; outcomes resolve here
// from the peppered run seed (the zone choice is the only client input). The deciding kick
// settles the game, resumes the stage, and either finishes it (full stage payload) or pends
// the NEXT tie's choice (the 2-game knockout round).

export async function POST(req: NextRequest) {
  await ensurePool(); // match resolution can re-validate the XI (pool ratings) — load it server-side first
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-kick:${user.id}`, 40, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string; action?: string; zone?: number; power?: string } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const runId = String(body.runId ?? "");
  const action = body.action === "shot" || body.action === "dive" ? body.action : null;
  const zone = Number.isInteger(body.zone) ? (body.zone as number) : -1;
  const power = (POWERS.includes(body.power ?? "") ? body.power : "good") as PenPower;
  if (!runId || !action) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (zone < 0 || zone > 8) return NextResponse.json({ error: "Bad zone" }, { status: 400 });

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = rowToRun(row);
  const s = (row as { pens_state?: WcStageState | null }).pens_state;
  if (!s || !s.pens) return NextResponse.json({ error: "No shootout in progress" }, { status: 409 });

  // Alternation guard: the replayed kicks decide whose input is due.
  const kicks = wcPensKicks(run, s);
  const st = shootoutStatus(kicks.a, kicks.b, "alternating");
  if (!st.decided) {
    const due = st.next === "a" ? "shot" : "dive";
    if (action !== due) return NextResponse.json({ error: `Expected a ${due}` }, { status: 409 });
  }

  const pens = s.pens;
  const next: WcStageState = st.decided ? s : {
    ...s,
    pens: {
      shots: action === "shot" ? [...pens.shots, zone as PenZone] : pens.shots,
      powers: action === "shot" ? [...pens.powers, power] : pens.powers,
      dives: action === "dive" ? [...pens.dives, zone as PenZone] : pens.dives,
    },
  };
  const after = wcPensKicks(run, next);

  // Not decided yet — persist the input and report the new state.
  if (!shootoutStatus(after.a, after.b, "alternating").decided) {
    const { error: e } = await db.from("draft_wc_runs")
      .update({ pens_state: next, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", user.id);
    if (e) return NextResponse.json({ error: "Could not save kick" }, { status: 500 });
    return NextResponse.json({ pensPending: { ...wcPensMeta(run, next), view: wcPensView(run, next) } });
  }

  // Decided — settle the game and resume the stage.
  const view = wcPensView(run, next); // role "done" + final — the client's banner
  const res = resumeAfterPens(run, next);
  const stage = s.stage;

  if (res.kind === "choice") {
    // The next game in this stage is also level — pause again for the player's choice.
    const { error } = await db.from("draft_wc_runs")
      .update({ pens_state: res.state, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Could not update run" }, { status: 500 });
    return NextResponse.json({ pensPending: { ...wcPensMeta(run, next), view }, nextTie: res.tie });
  }

  try {
    const finalized = await finalizeResolved(db, user.id, run, stage, res, row.ranked === true);
    return NextResponse.json({ pensPending: { ...wcPensMeta(run, next), view }, stage: finalized });
  } catch {
    return NextResponse.json({ error: "Could not record the result" }, { status: 500 });
  }
}

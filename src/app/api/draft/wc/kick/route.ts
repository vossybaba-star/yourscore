import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rowToRun, createWcDb, completeWcPens, wcPensKicks, wcPensView, wcPensMeta,
  type WcPensState,
} from "@/lib/draft/wc-server";
import { shootoutStatus, type PenColumn, type PenPower, type PenZone } from "@/lib/draft/pens";

const POWERS = ["under", "good", "perfect", "over"];

// One action in a World Cup knockout shootout: { runId, action: "shot"|"dive", zone }.
// You shoot your kicks and dive against the CPU's, alternating; outcomes resolve
// here from the peppered run seed (the zone choice is the only client input).
// The deciding kick settles the game, resumes the stage, and either finishes it
// (full stage payload) or pends the NEXT level knockout game.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-kick:${user.id}`, 40, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string; action?: string; zone?: number; power?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const runId = String(body.runId ?? "");
  const action = body.action === "shot" || body.action === "dive" ? body.action : null;
  const zone = Number.isInteger(body.zone) ? (body.zone as number) : -1;
  const power = (POWERS.includes(body.power ?? "") ? body.power : "good") as PenPower;
  if (!runId || !action) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (action === "shot" && (zone < 0 || zone > 8)) return NextResponse.json({ error: "Bad zone" }, { status: 400 });
  if (action === "dive" && (zone < 0 || zone > 2)) return NextResponse.json({ error: "Bad dive" }, { status: 400 });

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = rowToRun(row);
  const s = (row as { pens_state?: WcPensState | null }).pens_state;
  if (!s) return NextResponse.json({ error: "No shootout in progress" }, { status: 409 });

  // Alternation guard: the replayed kicks decide whose input is due.
  const kicks = wcPensKicks(run, s);
  const st = shootoutStatus(kicks.a, kicks.b, "alternating");
  if (!st.decided) {
    const due = st.next === "a" ? "shot" : "dive";
    if (action !== due) return NextResponse.json({ error: `Expected a ${due}` }, { status: 409 });
  }

  const next: WcPensState = st.decided ? s : {
    ...s,
    shots: action === "shot" ? [...s.shots, zone as PenZone] : s.shots,
    powers: action === "shot" ? [...(s.powers ?? []), power] : (s.powers ?? []),
    dives: action === "dive" ? [...s.dives, zone as PenColumn] : s.dives,
  };
  const after = wcPensKicks(run, next);

  // Not decided yet — persist the input and report the new state.
  if (!shootoutStatus(after.a, after.b, "alternating").decided) {
    const { error: e } = await db
      .from("draft_wc_runs")
      .update({ pens_state: next, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", user.id);
    if (e) return NextResponse.json({ error: "Could not save kick" }, { status: 500 });
    return NextResponse.json({ pensPending: { ...wcPensMeta(run, next), view: wcPensView(run, next) } });
  }

  // Decided — settle the game and resume the stage.
  const res = completeWcPens(run, next);
  if (res.rows.length > 0) {
    const { error: matchErr } = await db.from("draft_wc_matches").insert(res.rows);
    if (matchErr) return NextResponse.json({ error: "Could not record matches" }, { status: 500 });
  }

  const view = wcPensView(run, next); // role "done" + final — the client's banner

  if (res.pending) {
    const { error: e } = await db
      .from("draft_wc_runs")
      .update({ pens_state: res.pending, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", user.id);
    if (e) return NextResponse.json({ error: "Could not update run" }, { status: 500 });
    return NextResponse.json({
      pensPending: { ...wcPensMeta(run, next), view },
      // The NEXT game is also level — the client refetches to open its shootout.
      nextShootout: true,
    });
  }

  const { resolved, ...runPatch } = res.patch;
  const { error: runErr } = await db
    .from("draft_wc_runs")
    .update({
      ...runPatch,
      pens_state: null,
      updated_at: new Date().toISOString(),
      ...(resolved ? { resolved_at: new Date().toISOString() } : {}),
    })
    .eq("id", runId)
    .eq("user_id", user.id);
  if (runErr) return NextResponse.json({ error: "Could not update run" }, { status: 500 });

  const afterRun = { ...run, ...runPatch };
  return NextResponse.json({
    pensPending: { ...wcPensMeta(run, next), view },
    stage: {
      stage: s.stage,
      games: res.reveals,
      result: afterRun.status === "champion" ? "champion"
        : afterRun.status === "eliminated" ? "eliminated"
        : "through",
      run: afterRun,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { isPick, tallyPicks, type Pick, type Tally } from "@/lib/halftime/predict";

/**
 * The prediction polls — TWO phases per fixture (§0.6), rewritten off the pack
 * entirely:
 *
 *   GET  ?fixture=<fixtureId>&phase=<prematch|halftime>  → { closed, myPick, result, tally }
 *   POST { fixtureId, phase, pick }                      → record this fan's pick
 *
 * Both key on the FIXTURE, never on a quiz_packs row or its metadata — the
 * bug class this closes (E1/E2/E3) all came from reading the poll's context
 * off a pack. There is no packContext lookup here at all.
 *
 *   prematch  open only while now() < kickoff_at. Predicts the FULL-TIME result.
 *   halftime  open only once second_half_started_at IS NOT NULL and no result
 *             row exists yet for that phase. Predicts the SECOND-HALF result.
 *
 * A pick for a closed phase is refused with 409. One pick per user per
 * fixture PER PHASE (migration 110: PK (user_id, fixture_id, phase)).
 *
 * Server-authoritative, like /api/quiz/solo-complete: the client sends only
 * the fixture id, phase and a pick. The tally is counted under the service
 * role because halftime_predictions is deny-all RLS.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function svc(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

type Phase = "prematch" | "halftime";
function isPhase(v: unknown): v is Phase {
  return v === "prematch" || v === "halftime";
}

interface FixtureRow {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  second_half_started_at: string | null;
}

async function fixtureRow(db: SupabaseClient, fixtureId: number): Promise<FixtureRow | null> {
  const { data } = await db
    .from("halftime_releases")
    .select("fixture_id, home, away, kickoff_at, second_half_started_at")
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  return (data as FixtureRow | null) ?? null;
}

/** Is this phase currently open to a NEW pick, for this fixture, right now? */
function phaseOpen(row: FixtureRow, phase: Phase, resultExists: boolean): boolean {
  if (resultExists) return false; // already settled — never re-opens
  if (phase === "prematch") return Date.now() < new Date(row.kickoff_at).getTime();
  return row.second_half_started_at !== null; // halftime
}

interface FixtureState {
  tally: Tally;
  result: Pick | null;
}

async function fixtureState(db: SupabaseClient, fixtureId: number, phase: Phase): Promise<FixtureState> {
  const [{ data: picks }, { data: res }] = await Promise.all([
    db.from("halftime_predictions").select("pick").eq("fixture_id", fixtureId).eq("phase", phase),
    db
      .from("halftime_prediction_results")
      .select("result")
      .eq("fixture_id", fixtureId)
      .eq("phase", phase)
      .maybeSingle(),
  ]);
  const tally = tallyPicks(((picks ?? []) as { pick: Pick }[]).filter((p) => isPick(p.pick)));
  const result = (res as { result?: Pick } | null)?.result ?? null;
  return { tally, result };
}

async function myPickFor(db: SupabaseClient, userId: string, fixtureId: number, phase: Phase): Promise<Pick | null> {
  const { data } = await db
    .from("halftime_predictions")
    .select("pick")
    .eq("user_id", userId)
    .eq("fixture_id", fixtureId)
    .eq("phase", phase)
    .maybeSingle();
  return (data as { pick?: Pick } | null)?.pick ?? null;
}

export async function GET(req: NextRequest) {
  const fixtureId = Number(req.nextUrl.searchParams.get("fixture"));
  const phase = req.nextUrl.searchParams.get("phase");
  if (!Number.isInteger(fixtureId)) return NextResponse.json({ error: "fixture required" }, { status: 400 });
  if (!isPhase(phase)) return NextResponse.json({ error: "phase must be prematch|halftime" }, { status: 400 });

  const db = svc();
  const row = await fixtureRow(db, fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const state = await fixtureState(db, fixtureId, phase);
  const myPick = user ? await myPickFor(db, user.id, fixtureId, phase) : null;
  const open = phaseOpen(row, phase, state.result !== null);

  return NextResponse.json({
    home: row.home,
    away: row.away,
    phase,
    open,
    closed: state.result !== null,
    myPick,
    result: state.result,
    tally: state.tally,
  });
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`ht-predict:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { fixtureId?: unknown; phase?: unknown; pick?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  if (!isPhase(body.phase)) return NextResponse.json({ error: "phase must be prematch|halftime" }, { status: 400 });
  const phase = body.phase;
  if (!isPick(body.pick)) return NextResponse.json({ error: "pick must be home|draw|away" }, { status: 400 });
  const pick = body.pick;

  const db = svc();
  const row = await fixtureRow(db, fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });

  // Poll closes the moment the phase's window is over — reject a pick for a
  // closed phase with 409, never accept it silently.
  const preState = await fixtureState(db, fixtureId, phase);
  const open = phaseOpen(row, phase, preState.result !== null);
  if (!open) {
    return NextResponse.json(
      {
        closed: true,
        open: false,
        myPick: await myPickFor(db, user.id, fixtureId, phase),
        result: preState.result,
        tally: preState.tally,
        home: row.home,
        away: row.away,
        phase,
      },
      { status: 409 },
    );
  }

  // One pick per fan per fixture per phase, LOCKED: on a second attempt the
  // insert conflicts on the PK and we simply return the pick already on
  // record, never the new one.
  const { error } = await db
    .from("halftime_predictions")
    .insert({ user_id: user.id, fixture_id: fixtureId, phase, pick })
    .select()
    .single();

  const conflict = error?.code === "23505";
  if (error && !conflict) {
    console.error("[halftime/predict] insert failed", error);
    return NextResponse.json({ error: "could not record prediction" }, { status: 500 });
  }

  const state = await fixtureState(db, fixtureId, phase);
  const myPick = await myPickFor(db, user.id, fixtureId, phase);
  return NextResponse.json({
    home: row.home,
    away: row.away,
    phase,
    open: phaseOpen(row, phase, state.result !== null),
    closed: state.result !== null,
    locked: conflict, // true = you had already picked; we kept the original
    myPick,
    result: state.result,
    tally: state.tally,
  });
}

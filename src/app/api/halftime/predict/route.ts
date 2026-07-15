import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { isPick, tallyPicks, type Pick, type Tally } from "@/lib/halftime/predict";

/**
 * The halftime prediction poll — one call on the second half, per fan per
 * fixture.
 *
 *   GET  ?pack=<packId>   → { closed, myPick, result, tally }
 *   POST { packId, pick } → record this fan's pick (once; then locked)
 *
 * Server-authoritative, like /api/quiz/solo-complete: the client sends only the
 * pack id and a pick. The fixture, the two team names and whether the poll is
 * still open are all resolved here from the pack's own metadata and the result
 * table — the browser is never trusted with any of it. The tally is counted
 * under the service role because halftime_predictions is deny-all RLS, so no
 * client can read another fan's pick directly.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

// halftime_* tables are not in the generated DB types — one untyped handle.
function svc(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

interface PackContext {
  fixtureId: number;
  home: string;
  away: string;
}

/**
 * The fixture a halftime pack belongs to, from its own metadata. Returns null
 * for a pack that is not a released halftime pack — you cannot predict on
 * anything else. `status='published'` is the release gate (an unreleased pack is
 * not published), so a pre-whistle pack id resolves to null here too.
 */
async function packContext(db: SupabaseClient, packId: string): Promise<PackContext | null> {
  const { data, error } = await db
    .from("quiz_packs")
    .select("metadata, status")
    .eq("id", packId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { metadata: { halftime?: { fixture_id?: number; home?: string; away?: string } } | null; status: string };
  if (row.status !== "published") return null;
  const ht = row.metadata?.halftime;
  if (!ht || typeof ht.fixture_id !== "number" || !ht.home || !ht.away) return null;
  return { fixtureId: ht.fixture_id, home: ht.home, away: ht.away };
}

interface FixtureState {
  tally: Tally;
  result: Pick | null;
}

/** Tally + settled result for a fixture — the shared read both verbs return. */
async function fixtureState(db: SupabaseClient, fixtureId: number): Promise<FixtureState> {
  const [{ data: picks }, { data: res }] = await Promise.all([
    db.from("halftime_predictions").select("pick").eq("fixture_id", fixtureId),
    db.from("halftime_prediction_results").select("result").eq("fixture_id", fixtureId).maybeSingle(),
  ]);
  const tally = tallyPicks(((picks ?? []) as { pick: Pick }[]).filter((p) => isPick(p.pick)));
  const result = (res as { result?: Pick } | null)?.result ?? null;
  return { tally, result };
}

async function myPickFor(db: SupabaseClient, userId: string, fixtureId: number): Promise<Pick | null> {
  const { data } = await db
    .from("halftime_predictions")
    .select("pick")
    .eq("user_id", userId)
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  return (data as { pick?: Pick } | null)?.pick ?? null;
}

export async function GET(req: NextRequest) {
  const packId = req.nextUrl.searchParams.get("pack");
  if (!packId) return NextResponse.json({ error: "pack required" }, { status: 400 });

  const db = svc();
  const ctx = await packContext(db, packId);
  if (!ctx) return NextResponse.json({ error: "not a halftime pack" }, { status: 404 });

  // A signed-in fan sees their own pick; a guest just sees the tally + result.
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const state = await fixtureState(db, ctx.fixtureId);
  const myPick = user ? await myPickFor(db, user.id, ctx.fixtureId) : null;

  return NextResponse.json({
    home: ctx.home,
    away: ctx.away,
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

  let body: { packId?: unknown; pick?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const packId = typeof body.packId === "string" ? body.packId : "";
  if (!packId) return NextResponse.json({ error: "packId required" }, { status: 400 });
  if (!isPick(body.pick)) return NextResponse.json({ error: "pick must be home|draw|away" }, { status: 400 });
  const pick = body.pick;

  const db = svc();
  const ctx = await packContext(db, packId);
  if (!ctx) return NextResponse.json({ error: "not a halftime pack" }, { status: 404 });

  // Poll closes the moment the fixture is settled — you cannot predict a result
  // that is already known.
  const preState = await fixtureState(db, ctx.fixtureId);
  if (preState.result !== null) {
    return NextResponse.json(
      { closed: true, myPick: await myPickFor(db, user.id, ctx.fixtureId), result: preState.result, tally: preState.tally, home: ctx.home, away: ctx.away },
      { status: 409 },
    );
  }

  // One pick per fan per fixture, and it is LOCKED: on a second attempt the
  // insert conflicts on the PK and we simply return the pick already on record,
  // never the new one. No update path exists — not in RLS, not here.
  const { error } = await db
    .from("halftime_predictions")
    .insert({ user_id: user.id, fixture_id: ctx.fixtureId, pack_id: packId, pick })
    .select()
    .single();

  const conflict = error?.code === "23505";
  if (error && !conflict) {
    console.error("[halftime/predict] insert failed", error);
    return NextResponse.json({ error: "could not record prediction" }, { status: 500 });
  }

  const state = await fixtureState(db, ctx.fixtureId);
  const myPick = await myPickFor(db, user.id, ctx.fixtureId);
  return NextResponse.json({
    home: ctx.home,
    away: ctx.away,
    closed: state.result !== null,
    locked: conflict, // true = you had already picked; we kept the original
    myPick,
    result: state.result,
    tally: state.tally,
  });
}

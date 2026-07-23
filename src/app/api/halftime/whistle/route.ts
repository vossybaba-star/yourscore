import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/halftime/whistle — the real half-time whistle marker.
 *
 * The poller (whistle detection is the one job it kept from the old release
 * pipeline — see poller.mjs) POSTs the fixture id the moment SportMonks flips
 * to HT. This is now the ONLY thing the whistle triggers: it opens the
 * halftime prediction poll (§0.6) and is the backstop's own signal
 * (halftime-watchdog reads it too, in case the poller misses one).
 *
 * CAS on null: the first caller to see the flip wins, a repeat POST (or the
 * watchdog's own backstop check landing seconds later) is a no-op.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function db(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { fixtureId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }

  const raw = db();
  const { data: won, error } = await raw
    .from("halftime_releases")
    .update({ second_half_started_at: new Date().toISOString() })
    .eq("fixture_id", fixtureId)
    .is("second_half_started_at", null)
    .select("id, second_half_started_at");

  if (error) {
    console.error("[halftime/whistle] update failed", fixtureId, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (won && won.length) {
    return NextResponse.json({ ok: true, fixtureId, set: true, secondHalfStartedAt: won[0].second_half_started_at });
  }

  // Already set (or no such fixture) — idempotent no-op, never an error.
  const { data: existing } = await raw
    .from("halftime_releases")
    .select("second_half_started_at")
    .eq("fixture_id", fixtureId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    fixtureId,
    set: false,
    secondHalfStartedAt: (existing as { second_half_started_at?: string } | null)?.second_half_started_at ?? null,
  });
}

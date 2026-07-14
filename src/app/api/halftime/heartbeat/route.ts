import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * /api/halftime/heartbeat — the VPS poller's liveness beat.
 *
 * POST  the poller beats here every 60s while it is awake.
 * GET   the watchdog and the 4x/day health suite read staleness from here.
 *
 * This is what makes "the poller died" a detectable event rather than a silent
 * one. It also stops a second poller instance from starting: a fresh beat means
 * someone else is already on duty.
 *
 * Auth: Bearer CRON_SECRET (both verbs — beat data is operational, not public).
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ID = "poller";

function db(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let detail: unknown = null;
  try {
    const body = await req.json();
    detail = (body as { detail?: unknown })?.detail ?? null;
  } catch {
    // A beat with no body is still a valid beat.
  }

  const beatAt = new Date().toISOString();
  const { error } = await db()
    .from("halftime_heartbeat")
    .upsert({ id: ID, beat_at: beatAt, detail }, { onConflict: "id" });

  if (error) {
    console.error("[halftime/heartbeat] write failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: ID, beat_at: beatAt });
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await db()
    .from("halftime_heartbeat")
    .select("id, beat_at, detail")
    .eq("id", ID)
    .maybeSingle();

  const row = data as { id: string; beat_at: string; detail: unknown } | null;
  if (!row) return NextResponse.json({ beating: false, beat_at: null, ageSeconds: null, detail: null });

  const ageSeconds = Math.round((Date.now() - new Date(row.beat_at).getTime()) / 1000);
  return NextResponse.json({
    beating: true,
    beat_at: row.beat_at,
    ageSeconds,
    detail: row.detail ?? null,
  });
}

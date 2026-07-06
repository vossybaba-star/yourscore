import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Hourly cron: expire abandoned lobbies.
 *
 * A player-created room sits at status='lobby' until the host starts the game.
 * If the host never starts (closes the tab, gets distracted), the lobby used to
 * live forever — accumulating in the DB and, until the listing got an age
 * filter, showing in the public "Open Lobbies" list indefinitely.
 *
 * This sweep flips any room still in 'lobby' after STALE_HOURS to 'expired'.
 * Non-destructive (no delete) — rows are kept for analytics; they just stop
 * counting as joinable. The /play listing already hides lobbies older than 3h,
 * so this primarily keeps the table's working set clean.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
const STALE_HOURS = 3;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  // 'expired' is allowed by rooms_status_check as of migration 65 — use an
  // untyped handle to avoid the generated-types union complaining about the
  // literal.
  const raw = svc as unknown as SupabaseClient;

  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await raw
    .from("rooms")
    .update({ status: "expired" })
    .eq("type", "player")
    .eq("status", "lobby")
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ expired: data?.length ?? 0, cutoff });
}

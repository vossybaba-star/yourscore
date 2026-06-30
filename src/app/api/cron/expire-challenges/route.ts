import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Daily cron: expire stale async challenges.
 *
 * An h2h_challenge sits at status='awaiting_opponent' until the opponent plays.
 * If they never do, it should drop out of inboxes once past its 7-day expiry.
 * This flips any still-awaiting challenge past expires_at to 'expired' so the
 * Your-Turns inbox stays clean. Non-destructive (rows kept for history).
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // status is free text (no enum) so the literal needs no migration — use an
  // untyped handle to avoid the generated-types union complaining.
  const raw = createServiceClient() as unknown as SupabaseClient;

  const { data, error } = await raw
    .from("h2h_challenges")
    .update({ status: "expired" })
    .eq("status", "awaiting_opponent")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expired: data?.length ?? 0 });
}

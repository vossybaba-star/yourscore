import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sweepExpiredMemberChallenges } from "@/lib/fantasy/challenges";

/**
 * Daily cron: expire stale async challenges.
 *
 * An h2h_challenge sits at status='awaiting_opponent' until the opponent plays.
 * If they never do, it should drop out of inboxes once past its 7-day expiry.
 * This flips any still-awaiting challenge past expires_at to 'expired' so the
 * Your-Turns inbox stays clean. Non-destructive (rows kept for history).
 *
 * Also sweeps member_challenges (the Phase-3 wrapper around h2h_challenges/
 * quiz_duel) — that lifecycle had no cron of its own, so expiry was
 * lazy-on-read only (a pending row nobody ever opens stayed 'pending'
 * forever). Each of the three sweeps below is isolated in its own try/catch
 * so one failing sweep never blocks the other two.
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

  const now = new Date().toISOString();
  const result: { expired_1v1: number; expired_group: number; expired_member_challenges: number; errors: string[] } = {
    expired_1v1: 0, expired_group: 0, expired_member_challenges: 0, errors: [],
  };

  try {
    const { data: h2h, error } = await raw
      .from("h2h_challenges")
      .update({ status: "expired" })
      .eq("status", "awaiting_opponent")
      .lt("expires_at", now)
      .select("id");
    if (error) throw new Error(error.message);
    result.expired_1v1 = h2h?.length ?? 0;
  } catch (e) { result.errors.push(`h2h_challenges: ${(e as Error).message}`); }

  // Group challenges share the same 7-day lifecycle.
  try {
    const { data: grp, error } = await raw
      .from("group_challenges")
      .update({ status: "expired" })
      .eq("status", "open")
      .lt("expires_at", now)
      .select("id");
    if (error) throw new Error(error.message);
    result.expired_group = grp?.length ?? 0;
  } catch (e) { result.errors.push(`group_challenges: ${(e as Error).message}`); }

  // member_challenges — its own lifecycle, so its own reconcile()-driven sweep
  // (see sweepExpiredMemberChallenges's own doc) rather than a raw status flip.
  // A fresh, properly-typed client (challenges.ts's Db type), same as
  // fantasy-tick's own sweepDueCompetitions call, rather than reusing `raw`.
  try {
    const { acted } = await sweepExpiredMemberChallenges(createServiceClient());
    result.expired_member_challenges = acted;
  } catch (e) { result.errors.push(`member_challenges: ${(e as Error).message}`); }

  if (result.errors.length) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}

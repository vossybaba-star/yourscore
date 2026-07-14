import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";

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

  const now = new Date().toISOString();

  const { data: h2h, error: e1 } = await raw
    .from("h2h_challenges")
    .update({ status: "expired" })
    .eq("status", "awaiting_opponent")
    .lt("expires_at", now)
    .select("id, challenger_id, invited_user_id, quiz_pack_name");
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // Group challenges share the same 7-day lifecycle.
  const { data: grp, error: e2 } = await raw
    .from("group_challenges")
    .update({ status: "expired" })
    .eq("status", "open")
    .lt("expires_at", now)
    .select("id");
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Nudge the challenger when a TARGETED 1v1 challenge expired un-played (their
  // invited friend never took their turn). Open link-based challenges have no
  // single recipient to name, so skip those. Best-effort, opt-in-gated, deduped
  // per challenge (safe against cron re-runs). Cap the fan-out; log if truncated.
  // NB: this cron is scheduled in daytime (see vercel.json) so the push never
  // lands at an antisocial hour.
  const NOTIFY_CAP = 200;
  type ExpiredRow = { id: string; challenger_id: string | null; invited_user_id: string | null; quiz_pack_name: string | null };
  const allTargeted = ((h2h ?? []) as ExpiredRow[]).filter((c) => c.challenger_id && c.invited_user_id);
  const targeted = allTargeted.slice(0, NOTIFY_CAP);
  if (allTargeted.length > NOTIFY_CAP) {
    console.warn(`[expire-challenges] expiry pushes capped at ${NOTIFY_CAP} (of ${allTargeted.length})`);
  }
  if (targeted.length) {
    // Resolve invited friends' names in one batch for the copy.
    const inviteeIds = Array.from(new Set(targeted.map((c) => c.invited_user_id!)));
    const { data: names } = await raw
      .from("profiles")
      .select("id, display_name")
      .in("id", inviteeIds);
    const nameById = new Map<string, string>(
      (names ?? []).map((n: { id: string; display_name: string | null }) => [n.id, n.display_name ?? "your friend"])
    );
    for (const c of targeted) {
      const opp = nameById.get(c.invited_user_id!) ?? "your friend";
      void notifyUsers({
        userIds: [c.challenger_id!],
        title: `Your challenge to ${opp} expired ⏳`,
        body: `They didn't get to it. Send it again or take on someone new.`,
        url: `/play`,
        dedupeKey: `challenge-expired:${c.id}`,
      });
    }
  }

  return NextResponse.json({ expired_1v1: h2h?.length ?? 0, expired_group: grp?.length ?? 0, notified: targeted.length });
}

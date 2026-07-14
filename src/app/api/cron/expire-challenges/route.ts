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

// PostgREST caps every response at max_rows (1000 on this project), silently. So
// we never `UPDATE ... .select()` an unbounded set: the representation would be
// truncated while the UPDATE still committed every row, permanently stranding the
// rows past the cap (flipped to 'expired', so never re-seen, and never notified).
// Instead: SELECT a bounded batch of ids, UPDATE exactly those, notify, repeat.
const BATCH = 200; // rows expired + notified per pass
const MAX_PASSES = 10; // hard backstop: ≤2000 rows/run
const PUSH_CONCURRENCY = 10;

export const fetchCache = "force-no-store";

type ExpiredRow = { id: string; challenger_id: string | null; invited_user_id: string | null };

/** Await promises `limit` at a time — keeps the fan-out off the event loop's back. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

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

  let expired1v1 = 0;
  let notified = 0;
  let truncated = false;

  for (let pass = 0; ; pass++) {
    if (pass >= MAX_PASSES) {
      truncated = true; // more remain; tomorrow's run drains them
      console.warn(`[expire-challenges] hit MAX_PASSES (${MAX_PASSES}); more rows remain`);
      break;
    }

    // Oldest first, so a backlog drains in a stable order across runs.
    const { data: batch, error: eSel } = await raw
      .from("h2h_challenges")
      .select("id, challenger_id, invited_user_id")
      .eq("status", "awaiting_opponent")
      .lt("expires_at", now)
      .order("expires_at", { ascending: true })
      .limit(BATCH);
    if (eSel) return NextResponse.json({ error: eSel.message }, { status: 500 });

    const rows = (batch ?? []) as ExpiredRow[];
    if (!rows.length) break;

    const { error: eUpd } = await raw
      .from("h2h_challenges")
      .update({ status: "expired" })
      .in("id", rows.map((r) => r.id));
    if (eUpd) return NextResponse.json({ error: eUpd.message }, { status: 500 });
    expired1v1 += rows.length;

    // Nudge the challenger when a TARGETED 1v1 expired un-played (their invited
    // friend never took their turn). Open link-based challenges have no single
    // recipient to name, so skip those. Opt-in gated; deduped per challenge, so
    // a cron re-run cannot double-send.
    const targeted = rows.filter((c) => c.challenger_id && c.invited_user_id);
    if (targeted.length) {
      const inviteeIds = Array.from(new Set(targeted.map((c) => c.invited_user_id!)));
      const { data: names } = await raw
        .from("profiles")
        .select("id, display_name")
        .in("id", inviteeIds);
      const nameById = new Map<string, string>(
        (names ?? []).map((n: { id: string; display_name: string | null }) => [n.id, n.display_name ?? "your friend"])
      );

      // MUST await: Vercel freezes the invocation the moment we return, and a
      // dropped push is unrecoverable — the row is already 'expired', so the next
      // run will never reconsider it.
      await mapLimit(targeted, PUSH_CONCURRENCY, async (c) => {
        const opp = nameById.get(c.invited_user_id!) ?? "your friend";
        await notifyUsers({
          userIds: [c.challenger_id!],
          title: `Your challenge to ${opp} expired ⏳`,
          body: `They didn't get to it. Send it again or take on someone new.`,
          url: `/play`,
          dedupeKey: `challenge-expired:${c.id}`,
        });
      });
      notified += targeted.length;
    }

    if (rows.length < BATCH) break; // drained
  }

  // Group challenges share the same 7-day lifecycle (no per-row push, so the
  // bounded-batch dance isn't needed — but still cap the returned representation).
  const { data: grp, error: e2 } = await raw
    .from("group_challenges")
    .update({ status: "expired" })
    .eq("status", "open")
    .lt("expires_at", now)
    .select("id");
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({
    expired_1v1: expired1v1,
    expired_group: grp?.length ?? 0,
    notified,
    truncated,
  });
}

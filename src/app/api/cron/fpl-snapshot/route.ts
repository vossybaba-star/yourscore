import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchFplBootstrap } from "@/lib/gates/fpl";

/**
 * Hourly cron: capture a fresh FPL snapshot into `fantasy_fpl_snapshot`.
 *
 * This is the availability feed the Scout reads — injuries, doubts, ownership,
 * projections. There was NO refresh for it anywhere in the repo (it was being
 * fed by an external job that stopped), so the app's availability sat ~a day
 * stale. This route is the in-repo fix: one bootstrap-static fetch → one snapshot
 * batch, keyed by a single captured_at so every read of "the latest snapshot"
 * sees a consistent set. Old batches (>3 days) are pruned to bound growth.
 *
 * Auth: Bearer CRON_SECRET. Idempotent: a re-run just writes another batch.
 */
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const POS: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const numOrNull = (v: string | number | null | undefined): number | null =>
  v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let boot;
  try {
    boot = await fetchFplBootstrap();
  } catch (e) {
    return NextResponse.json({ error: `bootstrap fetch failed: ${(e as Error).message}` }, { status: 502 });
  }
  if (!boot?.elements?.length) {
    return NextResponse.json({ error: "bootstrap had no elements" }, { status: 502 });
  }

  // Gameweek pointers from the events list (fall back to deadline comparison).
  const now = Date.now();
  const events = boot.events ?? [];
  const nextEv = events.find((e) => e.is_next)
    ?? events.find((e) => new Date(e.deadline_time).getTime() > now)
    ?? null;
  const currentEv = events.find((e) => e.is_current) ?? null;
  const currentEvent = currentEv?.id ?? (nextEv ? nextEv.id - 1 : null);
  const nextEvent = nextEv?.id ?? null;
  const nextDeadline = nextEv?.deadline_time ?? null;

  const capturedAt = new Date().toISOString();
  const rows = boot.elements.map((e) => ({
    captured_at: capturedAt,
    current_event: currentEvent,
    next_event: nextEvent,
    next_deadline: nextDeadline,
    player_id: e.id,
    web_name: e.web_name,
    team: e.team,
    position: POS[e.element_type] ?? "MID",
    now_cost: e.now_cost,
    selected_by_percent: numOrNull(e.selected_by_percent),
    ep_this: numOrNull(e.ep_this),
    ep_next: numOrNull(e.ep_next),
    form: numOrNull(e.form),
    status: e.status ?? "u",
    news: e.news ? e.news : null,
    chance_of_playing_this_round: e.chance_of_playing_this_round ?? null,
    chance_of_playing_next_round: e.chance_of_playing_next_round ?? null,
    transfers_in_event: e.transfers_in_event ?? 0,
    transfers_out_event: e.transfers_out_event ?? 0,
    is_rehearsal: false,
  }));

  const db = createServiceClient();
  const { error } = await db.from("fantasy_fpl_snapshot").insert(rows);
  if (error) {
    return NextResponse.json({ error: `snapshot insert failed: ${error.message}` }, { status: 500 });
  }

  // Prune batches older than 3 days so the table doesn't grow unbounded. The
  // just-written batch is fresh, so this never removes the latest.
  const cutoff = new Date(now - 3 * 24 * 3_600_000).toISOString();
  await db.from("fantasy_fpl_snapshot").delete().lt("captured_at", cutoff).eq("is_rehearsal", false);

  return NextResponse.json({
    ok: true, captured_at: capturedAt, players: rows.length,
    currentEvent, nextEvent, nextDeadline,
  });
}

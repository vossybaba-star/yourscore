import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getPhasesForFixtures } from "@/lib/halftime/sportmonks";
import { settleFinishedFixtures } from "@/lib/halftime/settle";
import { londonDayRange, londonMatchday, type MatchPhase } from "@/lib/halftime/shared";

/**
 * GET /api/cron/halftime-watchdog — the 5-minute cron.
 *
 * REWORKED for the Gameday pivot (§0.5): this route no longer stages or
 * releases any quiz pack — that entire loop, and the ACTIONABLE/SETTLEABLE
 * quiz-state row selection it used, is gone. The Gameday pack's own lifecycle
 * is now owned end-to-end by /api/cron/gameday-publish (once daily), not by
 * this 5-minute cron.
 *
 * What is left is exactly the Halftime Prediction poll's own machinery
 * (§0.4/§0.5), and it is now TIME-based, never quiz-state-based — AC37: no
 * reference to 'released'/'released_late' as a quiz condition anywhere below.
 *
 *   1. Nothing to watch today → {idle:true}. ZERO SportMonks calls.
 *   2. Whistle backstop: any row whose kickoff has passed, within a 2h30
 *      window, with no second_half_started_at yet → one
 *      getPhasesForFixtures call → phase halftime/past_halftime sets it. This
 *      is the same signal /api/halftime/whistle records from the poller; the
 *      watchdog is the backstop for a poller that missed it.
 *   3. Settlement: every row whose kickoff has passed is a settle candidate,
 *      passed straight to settleFinishedFixtures — it already no-ops cheaply
 *      when nothing is ungraded, and getFinalScores only ever returns
 *      genuinely finished fixtures, so this is free on a day with nothing
 *      left to grade.
 *   4. Heartbeat staleness, unchanged.
 *
 * Auth: Bearer CRON_SECRET (Vercel cron sends it).
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Beyond this, a poller that should be beating is considered dead. */
const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
/** The poller is expected to be up from 80 min before the first kickoff... */
const WINDOW_LEAD_MS = 80 * 60 * 1000;
/** ...until ~2h45 after the last one (full time + the day summary). */
const WINDOW_TAIL_MS = 165 * 60 * 1000;
/** How long after kickoff the whistle backstop keeps checking a fixture. */
const WHISTLE_BACKSTOP_MS = 150 * 60 * 1000; // 2h30

interface Row {
  fixture_id: number;
  kickoff_at: string;
  second_half_started_at: string | null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient() as unknown as SupabaseClient;
  const now = new Date();
  const matchday = londonMatchday(now);
  const { startUtc, endUtc } = londonDayRange(matchday);

  const { data, error } = await db
    .from("halftime_releases")
    .select("fixture_id, kickoff_at, second_half_started_at")
    .eq("kind", "fixture")
    .neq("state", "cancelled")
    .gte("kickoff_at", startUtc)
    .lt("kickoff_at", endUtc);

  if (error) {
    console.error("[halftime-watchdog] query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const allRows = (data ?? []) as Row[];

  // ── 1. Idle. No SportMonks call is made on this path. ─────────────────────
  if (!allRows.length) {
    return NextResponse.json({ idle: true, matchday, checked: 0 });
  }

  const nowMs = now.getTime();

  // ── 2. Whistle backstop. ───────────────────────────────────────────────────
  // Rows whose kickoff has passed, still inside the backstop window, with no
  // whistle recorded yet. The poller's own POST to /api/halftime/whistle is
  // the primary path; this catches a poller that missed it.
  const needsWhistleCheck = allRows.filter((r) => {
    const ko = new Date(r.kickoff_at).getTime();
    return ko <= nowMs && nowMs < ko + WHISTLE_BACKSTOP_MS && r.second_half_started_at === null;
  });

  let whistleSet: number[] = [];
  if (needsWhistleCheck.length) {
    try {
      const phases: Map<number, MatchPhase> = await getPhasesForFixtures(
        needsWhistleCheck.map((r) => Number(r.fixture_id)),
      );
      const toSet = needsWhistleCheck.filter((r) => {
        const phase = phases.get(Number(r.fixture_id));
        return phase === "halftime" || phase === "past_halftime";
      });
      if (toSet.length) {
        const { data: won } = await db
          .from("halftime_releases")
          .update({ second_half_started_at: new Date().toISOString() })
          .in("fixture_id", toSet.map((r) => r.fixture_id))
          .is("second_half_started_at", null)
          .select("fixture_id");
        whistleSet = ((won ?? []) as { fixture_id: number }[]).map((r) => Number(r.fixture_id));
      }
    } catch (err) {
      console.error("[halftime-watchdog] whistle backstop failed", err);
    }
  }

  // ── 3. Settlement — every fixture past kickoff is a candidate. ────────────
  const settleCandidates = allRows
    .filter((r) => new Date(r.kickoff_at).getTime() <= nowMs)
    .map((r) => Number(r.fixture_id));

  let settled: Array<{ fixtureId: number; phase: string }> = [];
  let predictionsPending: number[] = [];
  try {
    const out = await settleFinishedFixtures(settleCandidates);
    settled = out.settled.map((s) => ({ fixtureId: s.fixtureId, phase: s.phase }));
    predictionsPending = out.pending;
  } catch (err) {
    console.error("[halftime-watchdog] settlement failed", err);
  }

  // ── 4. Heartbeat staleness inside the match window. ───────────────────────
  const heartbeat = await checkHeartbeat(db, allRows, now);
  if (heartbeat.stale) {
    console.error(
      `[halftime-watchdog] poller heartbeat is stale (${heartbeat.ageMinutes}m) during a match window on ${matchday}`,
    );
  }

  return NextResponse.json({
    idle: false,
    matchday,
    checked: allRows.length,
    whistleSet,
    settled,
    predictionsPending,
    heartbeat,
  });
}

/**
 * Is the poller beating when it should be? Only meaningful inside the window
 * where a poller is expected to be running — outside it, silence is correct.
 */
async function checkHeartbeat(
  db: SupabaseClient,
  rows: Row[],
  now: Date,
): Promise<{ stale: boolean; inWindow: boolean; ageMinutes: number | null }> {
  const kickoffs = rows.map((r) => new Date(r.kickoff_at).getTime()).filter(Number.isFinite);
  if (!kickoffs.length) return { stale: false, inWindow: false, ageMinutes: null };

  const windowStart = Math.min(...kickoffs) - WINDOW_LEAD_MS;
  const windowEnd = Math.max(...kickoffs) + WINDOW_TAIL_MS;
  const inWindow = now.getTime() >= windowStart && now.getTime() <= windowEnd;
  if (!inWindow) return { stale: false, inWindow: false, ageMinutes: null };

  const { data } = await db
    .from("halftime_heartbeat")
    .select("beat_at")
    .eq("id", "poller")
    .maybeSingle();

  const beatAt = (data as { beat_at: string } | null)?.beat_at;
  if (!beatAt) return { stale: true, inWindow: true, ageMinutes: null };

  const ageMs = now.getTime() - new Date(beatAt).getTime();
  return {
    stale: ageMs > HEARTBEAT_STALE_MS,
    inWindow: true,
    ageMinutes: Math.round(ageMs / 60000),
  };
}

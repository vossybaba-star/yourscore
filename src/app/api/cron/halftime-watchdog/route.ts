import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { cancelFixture, releaseFixture, stageFixture } from "@/lib/halftime/release";
import { getPhasesForFixtures } from "@/lib/halftime/sportmonks";
import { settleFinishedFixtures } from "@/lib/halftime/settle";
import {
  londonDayRange,
  londonMatchday,
  type HalftimeState,
  type MatchPhase,
} from "@/lib/halftime/shared";

/**
 * GET /api/cron/halftime-watchdog — the 5-minute backstop (Vercel cron).
 *
 * The VPS poller is the primary path: it sees the halftime flip within 6
 * seconds. This exists so that a dead poller degrades the feature instead of
 * killing it — worst case the pack lands ~6 minutes after the whistle, still
 * inside a real 15-minute half-time.
 *
 * It is deliberately NOT a second poller. It does the minimum a backstop must:
 *   1. Nothing awaiting release today  →  return {idle:true}. ZERO SportMonks
 *      calls. This is the common case (most days have no PL fixtures) and it
 *      must cost nothing — 288 runs a day of "no-op" is only cheap if it is
 *      genuinely a no-op.
 *   2. One call, querying today's fixtures BY ID (not the livescores feed —
 *      see getPhasesForFixtures). Staged fixture at HT → release (with push).
 *      Second half already under way → release `released_late` with NO push (a
 *      notification after the restart is useless and a spoiler risk).
 *      Postponed/abandoned → cancelled, never a pack.
 *   3. A fixture still `base_ready` after kick-off means the poller died before
 *      assembly → stage it BASE-ONLY. The watchdog never ships fresh questions:
 *      a dead poller means the veto ledger cannot be trusted end to end, so the
 *      conservative bound is the day-before, founder-approved base slate.
 *   4. A stale poller heartbeat inside a match window is reported loudly.
 *
 * Auth: Bearer CRON_SECRET (Vercel cron sends it).
 */

// A cron must never act on cached reads: without this Vercel's durable Data
// Cache pins the service-client GETs and the watchdog decides against a stale
// state machine forever.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Beyond this, a poller that should be beating is considered dead. */
const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
/** The poller is expected to be up from 80 min before the first kickoff... */
const WINDOW_LEAD_MS = 80 * 60 * 1000;
/** ...until ~2h45 after the last one (full time + the day summary). */
const WINDOW_TAIL_MS = 165 * 60 * 1000;

const ACTIONABLE: HalftimeState[] = ["base_ready", "staged"];
/** Already-live fixtures — nothing to release, but their predictions settle at FT. */
const SETTLEABLE: HalftimeState[] = ["released", "released_late"];
const WATCHED: HalftimeState[] = [...ACTIONABLE, ...SETTLEABLE];

interface Row {
  fixture_id: number;
  kickoff_at: string;
  state: HalftimeState;
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
    .select("fixture_id, kickoff_at, state")
    .gte("kickoff_at", startUtc)
    .lt("kickoff_at", endUtc)
    .in("state", WATCHED);

  if (error) {
    console.error("[halftime-watchdog] query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const allRows = (data ?? []) as Row[];

  // ── 1. Idle. No SportMonks call is made on this path. ─────────────────────
  // Zero fixtures today (the common case: most days have no PL football) → a
  // genuine no-op, which is the only thing that makes 288 runs a day cheap.
  if (!allRows.length) {
    return NextResponse.json({ idle: true, matchday, checked: 0 });
  }

  // Awaiting release vs already-live-and-awaiting-full-time. Only the first set
  // needs a phase check; the second only settles predictions, and only if any
  // are still ungraded (settleFinishedFixtures makes zero SportMonks calls when
  // there is nothing to grade — so an all-settled matchday stays cheap too).
  const rows = allRows.filter((r) => (ACTIONABLE as string[]).includes(r.state));
  const settleableIds = allRows
    .filter((r) => (SETTLEABLE as string[]).includes(r.state))
    .map((r) => Number(r.fixture_id));

  // ── 2. One call for the awaiting-release slate, BY FIXTURE ID. ────────────
  // Not /livescores/latest: that feed only carries fixtures updated in the last
  // ~10 seconds and drops them once they finish, so a 5-minute watchdog would
  // usually see an empty list and could never catch a half-time it had missed.
  let phases: Map<number, MatchPhase>;
  try {
    phases = await getPhasesForFixtures(rows.map((r) => Number(r.fixture_id)));
  } catch (err) {
    console.error("[halftime-watchdog] SportMonks unavailable", err);
    // The poller is the primary path and may well be fine. Fail soft and let
    // the next tick (5 min) retry rather than mangling any state.
    return NextResponse.json(
      { idle: false, matchday, error: "sportmonks unavailable", checked: allRows.length },
      { status: 200 },
    );
  }

  const released: number[] = [];
  const releasedLate: number[] = [];
  const cancelled: number[] = [];
  const stagedBaseOnly: number[] = [];
  const skipped: Array<{ fixture_id: number; reason: string }> = [];

  for (const row of rows) {
    const phase = phases.get(Number(row.fixture_id)) ?? "unknown";
    const kickoff = new Date(row.kickoff_at).getTime();

    // Postponed / abandoned / awarded — no pack, no push, ever.
    if (phase === "abnormal") {
      const res = await cancelFixture(row.fixture_id, `sportmonks phase=${phase}`);
      if (res.cancelled) cancelled.push(row.fixture_id);
      continue;
    }

    // 3. Poller died before assembly: stage the base slate so there is
    //    something to release. Only once kickoff has passed — before that the
    //    poller still has time to run the real (fresh-inclusive) assembly.
    if (row.state === "base_ready") {
      if (now.getTime() < kickoff) {
        skipped.push({ fixture_id: row.fixture_id, reason: "base_ready, pre-kickoff" });
        continue;
      }
      const res = await stageFixture(row.fixture_id, { baseOnly: true });
      if (res.staged) stagedBaseOnly.push(row.fixture_id);
      else {
        skipped.push({ fixture_id: row.fixture_id, reason: res.reason ?? "stage failed" });
        continue;
      }
    }

    // The fixture is (now) staged. Release only on a real state flip.
    if (phase === "halftime") {
      const out = await releaseFixture(row.fixture_id);
      if (out.released) released.push(row.fixture_id);
      else if (!out.already) skipped.push({ fixture_id: row.fixture_id, reason: out.reason ?? "release failed" });
    } else if (phase === "past_halftime") {
      // Half-time came and went while nobody was watching. Ship it, silently.
      const out = await releaseFixture(row.fixture_id, { late: true });
      if (out.released) releasedLate.push(row.fixture_id);
      else if (!out.already) skipped.push({ fixture_id: row.fixture_id, reason: out.reason ?? "late release failed" });
    } else {
      // pre / first_half / unknown → nothing to do. Never release on a timer.
      skipped.push({ fixture_id: row.fixture_id, reason: `phase=${phase}` });
    }
  }

  // ── 4. Settle predictions for fixtures now at full time. ──────────────────
  // Rides this same 5-minute cron: full time lands ~45 min after the pack was
  // released, comfortably inside the cadence. settleFinishedFixtures short-
  // circuits to zero SportMonks calls when nothing is ungraded, so this is free
  // on a matchday whose predictions are all in. (The poller could settle faster
  // one day, but the watchdog alone is correct and survives a dead poller.)
  let settled: number[] = [];
  let predictionsPending: number[] = [];
  try {
    const out = await settleFinishedFixtures(settleableIds);
    settled = out.settled.map((s) => s.fixtureId);
    predictionsPending = out.pending;
  } catch (err) {
    console.error("[halftime-watchdog] settlement failed", err);
  }

  // ── 5. Heartbeat staleness inside the match window. ───────────────────────
  const heartbeat = await checkHeartbeat(db, allRows, now);
  if (heartbeat.stale) {
    // Sentry picks this up; Telegram alerting is the poller's own job (the VPS
    // owns those creds) — this is the always-on, dependency-free signal.
    console.error(
      `[halftime-watchdog] poller heartbeat is stale (${heartbeat.ageMinutes}m) during a match window on ${matchday}`,
    );
  }

  return NextResponse.json({
    idle: false,
    matchday,
    checked: allRows.length,
    released,
    releasedLate,
    cancelled,
    stagedBaseOnly,
    settled,
    predictionsPending,
    skipped,
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

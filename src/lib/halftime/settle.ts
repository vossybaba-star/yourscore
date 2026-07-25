import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getFinalScores } from "@/lib/halftime/sportmonks";
import { resultFromGoals, type Pick } from "@/lib/halftime/predict";

/**
 * Prediction settlement — grade every fan's call once the match is over, for
 * BOTH phases (§0.6):
 *   prematch  graded against the FULL-TIME result.
 *   halftime  graded against the SECOND-HALF-ONLY result.
 * A PL fixture has no extra time, so both phases become gradeable at the same
 * SportMonks signal (full time) — they simply read a different split of the
 * same already-fetched `scores` payload (see getFinalScores).
 *
 * Idempotent by construction, so both the watchdog (its primary caller, every
 * 5 minutes) and a future poller hook can invoke it freely and a re-run
 * changes nothing:
 *   - a (fixture, phase) with a result row is already settled → skipped;
 *   - grading is a pair of set-to-constant updates, so writing them twice is
 *     a no-op;
 *   - the result row upsert ignores conflicts.
 *
 * settlement no longer depends on any quiz pack state (AC37) — candidates are
 * whatever fixtures the caller thinks have reached kickoff, full stop.
 *
 * The whole path is service-role: halftime_predictions is deny-all RLS, and
 * the tally/grading must read every fan's pick, which no single client may do.
 */

function svc(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

type PredictionPhase = "prematch" | "halftime";

interface SettleOutcome {
  fixtureId: number;
  phase: PredictionPhase;
  result: Pick;
  graded: number;
}

interface PendingRow {
  fixture_id: number;
  phase: PredictionPhase;
}

/**
 * Given candidate fixture ids (today's fixtures whose kickoff has passed),
 * settle every (fixture, phase) pair that still has ungraded predictions and
 * whose result SportMonks can now supply. Fixtures not yet finished, or
 * finished without a complete second-half split yet, are simply left for the
 * next tick.
 */
export async function settleFinishedFixtures(
  candidateFixtureIds: number[],
): Promise<{ settled: SettleOutcome[]; pending: number[] }> {
  const db = svc();
  const settled: SettleOutcome[] = [];

  if (!candidateFixtureIds.length) return { settled, pending: [] };

  const { data: ungraded, error } = await db
    .from("halftime_predictions")
    .select("fixture_id, phase")
    .in("fixture_id", candidateFixtureIds)
    .is("correct", null);

  if (error) {
    console.error("[halftime-settle] ungraded query failed", error);
    return { settled, pending: [] };
  }

  const rows = (ungraded ?? []) as PendingRow[];
  const pendingFixtureIds = Array.from(new Set(rows.map((r) => Number(r.fixture_id))));
  if (!pendingFixtureIds.length) return { settled, pending: [] };

  // One SportMonks call for the whole set; finished-only entries come back.
  const scores = await getFinalScores(pendingFixtureIds);

  const stillPendingFixtures = new Set<number>();

  for (const fixtureId of pendingFixtureIds) {
    const final = scores.get(fixtureId);
    if (!final) {
      stillPendingFixtures.add(fixtureId);
      continue; // not finished yet — try again next tick
    }

    const phasesForFixture = new Set(
      rows.filter((r) => Number(r.fixture_id) === fixtureId).map((r) => r.phase),
    );

    if (phasesForFixture.has("prematch")) {
      const result = resultFromGoals(final.home, final.away);
      const graded = await settlePhase(db, fixtureId, "prematch", result, final.home, final.away);
      if (graded !== null) settled.push({ fixtureId, phase: "prematch", result, graded });
      else stillPendingFixtures.add(fixtureId);
    }

    if (phasesForFixture.has("halftime")) {
      if (!final.secondHalf) {
        // Finished, but the 2ND_HALF split has not landed on the feed yet.
        stillPendingFixtures.add(fixtureId);
      } else {
        const result = resultFromGoals(final.secondHalf.home, final.secondHalf.away);
        const graded = await settlePhase(db, fixtureId, "halftime", result, final.secondHalf.home, final.secondHalf.away);
        if (graded !== null) settled.push({ fixtureId, phase: "halftime", result, graded });
        else stillPendingFixtures.add(fixtureId);
      }
    }
  }

  return { settled, pending: Array.from(stillPendingFixtures) };
}

/**
 * Settle one (fixture, phase): write the result row (ignore-conflict, so a
 * re-run is a no-op) and grade every still-ungraded pick for that phase.
 * Returns the number graded, or null on a hard failure (left pending).
 */
async function settlePhase(
  db: SupabaseClient,
  fixtureId: number,
  phase: "prematch" | "halftime",
  result: Pick,
  homeGoals: number,
  awayGoals: number,
): Promise<number | null> {
  const { error: resErr } = await db
    .from("halftime_prediction_results")
    .upsert(
      { fixture_id: fixtureId, phase, home_goals: homeGoals, away_goals: awayGoals, result },
      { onConflict: "fixture_id,phase", ignoreDuplicates: true },
    );
  if (resErr) {
    console.error("[halftime-settle] result upsert failed", fixtureId, phase, resErr);
    return null;
  }

  const { error: hitErr, count: hits } = await db
    .from("halftime_predictions")
    .update({ correct: true }, { count: "exact" })
    .eq("fixture_id", fixtureId)
    .eq("phase", phase)
    .eq("pick", result)
    .is("correct", null);
  const { error: missErr, count: misses } = await db
    .from("halftime_predictions")
    .update({ correct: false }, { count: "exact" })
    .eq("fixture_id", fixtureId)
    .eq("phase", phase)
    .neq("pick", result)
    .is("correct", null);

  if (hitErr || missErr) {
    console.error("[halftime-settle] grade failed", fixtureId, phase, hitErr ?? missErr);
    return null;
  }

  const graded = (hits ?? 0) + (misses ?? 0);
  console.log(`[halftime-settle] ${fixtureId} ${phase} → ${result} (graded ${graded})`);
  return graded;
}

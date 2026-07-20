import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getFinalScores } from "@/lib/halftime/sportmonks";
import { resultFromGoals, type Pick } from "@/lib/halftime/predict";

/**
 * Prediction settlement — grade every fan's second-half call once the match is
 * over.
 *
 * Idempotent by construction, so both the watchdog (its primary caller, every 5
 * minutes) and the poller (if we ever wire it) can invoke it freely and a re-run
 * changes nothing:
 *   - a fixture with a result row is already settled → skipped;
 *   - grading is a pair of set-to-constant updates, so writing them twice is a
 *     no-op;
 *   - the result row upsert ignores conflicts.
 *
 * The whole path is service-role: halftime_predictions is deny-all RLS, and the
 * tally / grading must read every fan's pick, which no single client may do.
 */

// halftime_predictions / _results are not in the generated DB types (same as
// halftime_releases). One untyped handle, one place, documented.
function svc(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

interface SettleOutcome {
  fixtureId: number;
  result: Pick;
  graded: number;
}

/**
 * Given candidate fixture ids (today's released fixtures), settle the ones that
 * (a) still have ungraded predictions and (b) SportMonks now reports finished
 * with a complete final score. Returns what it settled; fixtures not yet
 * finished are simply left for the next tick.
 */
export async function settleFinishedFixtures(
  candidateFixtureIds: number[],
): Promise<{ settled: SettleOutcome[]; pending: number[] }> {
  const db = svc();
  const settled: SettleOutcome[] = [];

  if (!candidateFixtureIds.length) return { settled, pending: [] };

  // Which candidates still have an ungraded pick? (correct IS NULL). No point
  // calling SportMonks for a fixture whose predictions are all already graded.
  const { data: ungraded, error } = await db
    .from("halftime_predictions")
    .select("fixture_id")
    .in("fixture_id", candidateFixtureIds)
    .is("correct", null);

  if (error) {
    console.error("[halftime-settle] ungraded query failed", error);
    return { settled, pending: [] };
  }

  const pending = Array.from(
    new Set(((ungraded ?? []) as { fixture_id: number }[]).map((r) => Number(r.fixture_id))),
  );
  if (!pending.length) return { settled, pending: [] };

  // One SportMonks call for the whole set; finished-only entries come back.
  const scores = await getFinalScores(pending);

  for (const fixtureId of pending) {
    const final = scores.get(fixtureId);
    if (!final) continue; // not finished yet — try again next tick
    const result = resultFromGoals(final.home, final.away);

    // Record the fixture result first (also the "predictions closed" flag the
    // POST /predict route checks). Ignore-conflict so a re-run is a no-op.
    const { error: resErr } = await db
      .from("halftime_prediction_results")
      .upsert(
        { fixture_id: fixtureId, home_goals: final.home, away_goals: final.away, result },
        { onConflict: "fixture_id", ignoreDuplicates: true },
      );
    if (resErr) {
      console.error("[halftime-settle] result upsert failed", fixtureId, resErr);
      continue;
    }

    // Grade: two set-to-constant updates, no per-row loop. Scoped to ungraded
    // rows so a late-inserted pick (see the predict route's close check) is not
    // clobbered — though the result row now blocks new picks anyway.
    const { error: hitErr, count: hits } = await db
      .from("halftime_predictions")
      .update({ correct: true }, { count: "exact" })
      .eq("fixture_id", fixtureId)
      .eq("pick", result)
      .is("correct", null);
    const { error: missErr, count: misses } = await db
      .from("halftime_predictions")
      .update({ correct: false }, { count: "exact" })
      .eq("fixture_id", fixtureId)
      .neq("pick", result)
      .is("correct", null);

    if (hitErr || missErr) {
      console.error("[halftime-settle] grade failed", fixtureId, hitErr ?? missErr);
      continue;
    }

    const graded = (hits ?? 0) + (misses ?? 0);
    settled.push({ fixtureId, result, graded });
    console.log(`[halftime-settle] ${fixtureId} → ${result} (graded ${graded})`);
  }

  const stillPending = pending.filter((id) => !scores.has(id));
  return { settled, pending: stillPending };
}

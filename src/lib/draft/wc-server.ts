/**
 * 38-0 World Cup Run — server-side run logic (authoritative).
 *
 * Wires the pure run engine (wc.ts) to the data pool + match engine. The client is
 * never trusted: the nation-locked XI is re-validated and re-scored here, opponents
 * are generated server-side, and goals are resolved by the shared two-half engine.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Formation, PlacedPlayer } from "./types";
import { createDraftDb, validateAndScore } from "./server";
import { getPlayer, getNation } from "./pool";
import { makeOpponent } from "./opponent";
import { resolveMatch, type SingleMatchResult } from "./live-score";
import { seededRng } from "./score";
import {
  planRun, type WCStage, type WCPlan, type WCFixture,
  type WcRun, currentFixture, applyResult,
} from "./wc";

export { currentFixture, applyResult };
export type { WcRun };

/** Service-role client for the World Cup tables. The draft_wc_* tables aren't in the
 *  generated DraftDatabase type yet, so we widen the client here in one place. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWcDb(): SupabaseClient<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createDraftDb() as unknown as SupabaseClient<any>;
}

/** Map a draft_wc_runs DB row to the WcRun working shape. */
export function rowToRun(row: Record<string, unknown>): WcRun {
  return {
    id: String(row.id),
    nation: String(row.nation),
    seed: String(row.seed),
    status: row.status as WcRun["status"],
    stage: row.stage as WCStage,
    stage_index: Number(row.stage_index),
    formation: row.formation as Formation,
    squad: (row.squad ?? []) as PlacedPlayer[],
    strength: Number(row.strength),
    plan: row.plan as WCPlan,
    group_played: Number(row.group_played),
    group_points: Number(row.group_points),
    upgrades_left: Number(row.upgrades_left),
  };
}

/** Validate a submitted XI AND enforce that every player is from `nation`. */
export function validateNationLocked(formationRaw: unknown, squadRaw: unknown, nation: string) {
  if (!getNation(nation)) throw new Error(`Unknown or unplayable nation: ${nation}`);
  const team = validateAndScore(formationRaw, squadRaw);
  for (const p of team.squad) {
    const full = getPlayer(p.player_season_id);
    if (!full || full.nationality !== nation) {
      throw new Error(`${p.name} is not eligible for ${nation}`);
    }
  }
  return team;
}

/** Plan a fresh run for a nation (deterministic by seed). */
export function newRunPlan(nation: string, seed: string): WCPlan {
  return planRun(nation, seed);
}

/** Build the opponent's XI: a strength-tuned bot at the fixture's target, labelled
 *  with the real fixture nation (opponents aren't nation-locked — flag + name only). */
export function buildOpponent(run: WcRun, fixture: WCFixture & { idx: number }) {
  const seed = `${run.seed}:opp:${fixture.stage}:${fixture.idx}`;
  const opp = makeOpponent(run.formation as Formation, fixture.oppTarget, seededRng(seed));
  return { squad: opp.team.squad, strength: opp.team.strength };
}

/** Resolve the current fixture (deterministic). Returns the match result + opponent. */
export function resolveFixture(run: WcRun, fixture: WCFixture & { idx: number; allowDraw: boolean }): {
  result: SingleMatchResult;
  oppStrength: number;
} {
  const opp = buildOpponent(run, fixture);
  const seed = `${run.seed}:match:${fixture.stage}:${fixture.idx}`;
  const result = resolveMatch(run.squad, opp.squad, seed, { allowDraw: fixture.allowDraw });
  return { result, oppStrength: opp.strength };
}

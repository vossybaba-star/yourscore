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
import { getPlayer, getNation, isWCEligible } from "./pool";
import { makeOpponent } from "./opponent";
import { resolveMatch } from "./live-score";
import { seededRng } from "./score";
import {
  planRun, planWorldRun, gamesForStage, buildMatchRow, outcomeOf, allowDraw, advanceStage, isDuel, oppTargetFor,
  WORLD_TEAM_NAME,
  type WCPlan, type WCFixture, type WcRun, type WcMatchRow, type WcRunPatch,
  type RunStage, type GameOutcome, type RunMode,
} from "./wc";

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
    mode: (row.mode === "world" ? "world" : "nation") as RunMode,
    nation: String(row.nation),
    seed: String(row.seed),
    status: row.status as WcRun["status"],
    stage: row.stage as RunStage,
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

/** Validate a submitted XI for the open World Cup mode: every player must be eligible
 *  (nationality at WC 2026), but ANY nation is allowed — no single-nation lock. */
export function validateWorld(formationRaw: unknown, squadRaw: unknown) {
  const team = validateAndScore(formationRaw, squadRaw);
  for (const p of team.squad) {
    const full = getPlayer(p.player_season_id);
    if (!full || !isWCEligible(full)) {
      throw new Error(`${p.name} is not at the World Cup`);
    }
  }
  return team;
}

/** Plan a fresh run (deterministic by seed). World mode generates a gauntlet bracket;
 *  nation mode uses the nation's real group + a seeded bracket. */
export function newRunPlan(mode: RunMode, nation: string, seed: string): WCPlan {
  return mode === "world" ? planWorldRun(seed) : planRun(nation, seed);
}

export { WORLD_TEAM_NAME };

/** Build a game's opponent XI: a strength-tuned bot at the fixture target, labelled
 *  with the real fixture nation (opponents aren't nation-locked — flag + name only).
 *  Deterministic by (run seed, stage, game index) so the revealed XI == the played XI. */
export function buildOpponent(run: WcRun, fixture: WCFixture, idx: number) {
  const seed = `${run.seed}:opp:${fixture.stage}:${idx}`;
  const target = oppTargetFor(run.strength, fixture.stage); // proportional to YOUR current Strength
  const opp = makeOpponent(run.formation as Formation, target, seededRng(seed));
  return { squad: opp.team.squad, strength: opp.team.strength };
}

export type GameReveal = {
  label: string;
  opponent: WCFixture["opponent"];
  oppStrength: number;
  goals: { you: number; opp: number };
  pens: { you: number; opp: number } | null;
  outcome: GameOutcome;
};

/** For a DUEL stage (qf/sf/final), the opponent you're about to face — squad shown so
 *  the player can make changes. Same seed as play, so it's the team actually faced. */
export function revealOpponent(run: WcRun) {
  if (run.status !== "active" || !isDuel(run.stage)) return null;
  const fixture = gamesForStage(run.plan, run.stage)[0];
  const opp = buildOpponent(run, fixture, 0);
  return {
    nation: fixture.opponent.nation,
    crest: fixture.opponent.crest,
    label: fixture.label,
    formation: run.formation,
    squad: opp.squad,
    strength: opp.strength,
  };
}

/**
 * Resolve the run's CURRENT stage in one go: every game (group=3, ko=2, duel=1) is
 * simulated deterministically, recorded, and the run advances. Returns the match rows
 * to insert, per-game reveals for the UI, and the run patch.
 */
export function resolveStage(run: WcRun): { rows: WcMatchRow[]; reveals: GameReveal[]; patch: WcRunPatch } {
  const fixtures = gamesForStage(run.plan, run.stage);
  const rows: WcMatchRow[] = [];
  const reveals: GameReveal[] = [];
  const outcomes: GameOutcome[] = [];

  fixtures.forEach((fixture, idx) => {
    const opp = buildOpponent(run, fixture, idx);
    const seed = `${run.seed}:match:${fixture.stage}:${idx}`;
    const result = resolveMatch(run.squad, opp.squad, seed, { allowDraw: allowDraw(run.stage) });
    rows.push(buildMatchRow(run.id, run.stage, fixture, result, opp.strength, idx));
    outcomes.push(outcomeOf(result));
    reveals.push({
      label: fixture.label,
      opponent: fixture.opponent,
      oppStrength: opp.strength,
      goals: { you: result.goals.a, opp: result.goals.b },
      pens: result.pens ? { you: result.pens.a, opp: result.pens.b } : null,
      outcome: outcomeOf(result),
    });
  });

  return { rows, reveals, patch: advanceStage(run, outcomes) };
}

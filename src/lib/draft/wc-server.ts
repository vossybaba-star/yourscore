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
import { createDraftDb, validateAndScore, GLOBAL_LEAGUE } from "./server";
import { getPlayer, getNation, isWCEligible } from "./pool";
import { deciderQuestion } from "./wc-quiz";
import { makeOpponent } from "./opponent";
import { resolveMatch, buildReport, type MatchSim, type SingleMatchResult } from "./live-score";
import { seededRng } from "./score";
import {
  planRun, planWorldRun, gamesForStage, buildMatchRow, outcomeOf, advanceStage, isDuel, oppTargetFor,
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
  decidedByQuestion?: boolean; // true when a draw was settled by the quiz decider
};

/** A question (no correct index) sent to the client to settle a drawn tie / play-off. */
export type PublicQuestion = { id: string; prompt: string; options: string[]; category: string };

/** A drawn tie (or the play-off) awaiting the player's decider answer. */
export type PendingDecider = {
  idx: number;
  stage: RunStage;
  label: string;
  opponent: WCFixture["opponent"];
  oppStrength: number;
  goals: { you: number; opp: number }; // the level 90' score (0-0 for the play-off)
  question: PublicQuestion;
};

export type StageResolution =
  | { kind: "resolved"; rows: WcMatchRow[]; reveals: GameReveal[]; patch: WcRunPatch }
  | { kind: "decider"; deciders: PendingDecider[] };

const publicQuestion = (q: { id: string; prompt: string; options: string[]; category: string }): PublicQuestion =>
  ({ id: q.id, prompt: q.prompt, options: q.options, category: q.category });

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
 * Resolve the run's CURRENT stage. Group games are simulated and scored on points (draws
 * allowed). Knockout ties that finish level — and the qualification play-off — are settled
 * by a **quiz decider** instead of a penalty shootout (temporary, until the shootout work
 * lands): a correct answer goes through, wrong is out.
 *
 * Called twice for a stage that contains a draw: first with no `answers` (returns
 * `kind:"decider"` with the question(s) and DOESN'T persist); then from /decide with the
 * player's answers (everything is deterministic from the run seed, so the non-drawn games
 * re-simulate identically) → `kind:"resolved"`.
 */
export function resolveStage(run: WcRun, answers: Record<number, number> = {}): StageResolution {
  const deciderSeed = (idx: number) => `${run.seed}:decider:${run.stage}:${idx}`;

  // Qualification play-off: no 90 minutes — a single decider question. Recorded with
  // stage='playoff' so it's a GATE (excluded from the W/D/L record + season points).
  // Falls back to the first knockout opponent for any in-flight run whose stored plan
  // predates plan.playoff.
  if (run.stage === "playoff") {
    const fixture = run.plan.playoff ?? run.plan.knockouts[0];
    const opp = buildOpponent(run, fixture, 0);
    const q = deciderQuestion(deciderSeed(0));
    if (answers[0] === undefined) {
      return { kind: "decider", deciders: [{ idx: 0, stage: "playoff", label: "Qualification Play-off", opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: 0, opp: 0 }, question: publicQuestion(q) }] };
    }
    const won = answers[0] === q.correctIndex;
    const result: SingleMatchResult = { outcome: won ? "A" : "B", goals: { a: 0, b: 0 }, pens: null, report: buildReport({} as MatchSim) };
    const row = buildMatchRow(run.id, "playoff", fixture, result, opp.strength, 0);
    const reveal: GameReveal = { label: "Qualification Play-off", opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: 0, opp: 0 }, pens: null, outcome: won ? "win" : "loss", decidedByQuestion: true };
    return { kind: "resolved", rows: [row], reveals: [reveal], patch: advanceStage(run, [won ? "win" : "loss"]) };
  }

  const fixtures = gamesForStage(run.plan, run.stage);
  const settled: { row: WcMatchRow; reveal: GameReveal; outcome: GameOutcome }[] = [];
  const pending: PendingDecider[] = [];

  fixtures.forEach((fixture, idx) => {
    const opp = buildOpponent(run, fixture, idx);
    // Always allow a 90' draw to surface (knockout ties go to the quiz decider, not pens).
    const result = resolveMatch(run.squad, opp.squad, `${run.seed}:match:${fixture.stage}:${idx}`, { allowDraw: true });
    const drawn = outcomeOf(result) === "draw" && run.stage !== "group";

    if (drawn) {
      const q = deciderQuestion(deciderSeed(idx));
      if (answers[idx] === undefined) {
        pending.push({ idx, stage: run.stage, label: fixture.label, opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: result.goals.a, opp: result.goals.b }, question: publicQuestion(q) });
        return;
      }
      const won = answers[idx] === q.correctIndex;
      const decided: SingleMatchResult = { ...result, outcome: won ? "A" : "B", pens: null };
      settled.push({
        row: buildMatchRow(run.id, run.stage, fixture, decided, opp.strength, idx),
        reveal: { label: fixture.label, opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: result.goals.a, opp: result.goals.b }, pens: null, outcome: won ? "win" : "loss", decidedByQuestion: true },
        outcome: won ? "win" : "loss",
      });
      return;
    }

    settled.push({
      row: buildMatchRow(run.id, run.stage, fixture, result, opp.strength, idx),
      reveal: { label: fixture.label, opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: result.goals.a, opp: result.goals.b }, pens: result.pens ? { you: result.pens.a, opp: result.pens.b } : null, outcome: outcomeOf(result) },
      outcome: outcomeOf(result),
    });
  });

  if (pending.length > 0) return { kind: "decider", deciders: pending };

  return {
    kind: "resolved",
    rows: settled.map((s) => s.row),
    reveals: settled.map((s) => s.reveal),
    patch: advanceStage(run, settled.map((s) => s.outcome)),
  };
}

/**
 * Persist a resolved stage and return the play/decide response. Inserts the match rows,
 * advances the run, and (for a ranked daily run) credits each game to YourScore Rank —
 * play-off games excluded, since the play-off is a qualification gate.
 */
export async function finalizeResolved(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>, userId: string, run: WcRun, stageBefore: RunStage,
  res: Extract<StageResolution, { kind: "resolved" }>, ranked: boolean
): Promise<{ stage: RunStage; games: GameReveal[]; result: "through" | "eliminated" | "champion"; run: WcRun }> {
  await db.from("draft_wc_matches").insert(res.rows);

  const { resolved, ...runPatch } = res.patch;
  await db.from("draft_wc_runs")
    .update({ ...runPatch, updated_at: new Date().toISOString(), ...(resolved ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", run.id).eq("user_id", userId);

  if (ranked && stageBefore !== "playoff") {
    const { data: prof } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    const name = (prof?.display_name as string) ?? "Player";
    for (const g of res.reveals) {
      await db.rpc("draft_credit_result", { p_user: userId, p_name: name, p_result: g.outcome, p_league: GLOBAL_LEAGUE, p_competition: "WC" });
    }
  }

  const after = { ...run, ...runPatch };
  return {
    stage: stageBefore,
    games: res.reveals,
    result: after.status === "champion" ? "champion" : after.status === "eliminated" ? "eliminated" : "through",
    run: after,
  };
}

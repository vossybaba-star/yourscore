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
import { resolveMatch, type SingleMatchResult } from "./live-score";
import { seededRng } from "./score";
import {
  resolveRound, shootoutStatus, resolveInteractiveShootout,
  type PenKick, type PenZone, type PenColumn, type PenPower,
} from "./pens";
import { pensSeed } from "./pens-server";
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

/** A knockout game paused mid-stage for its interactive shootout (the user takes
 *  the kicks — see pens.ts). Stored on draft_wc_runs.pens_state (migration 35).
 *  `outcomesSoFar`/`revealsSoFar` carry the games already settled in this stage so
 *  resolution can resume exactly where it stopped (the 2-game "ko" stage can pend
 *  twice in one play). */
export type WcPensState = {
  stage: RunStage;
  idx: number;
  goals: { you: number; opp: number };
  outcomesSoFar: GameOutcome[];
  revealsSoFar: GameReveal[];
  shots: PenZone[];
  powers: PenPower[];
  dives: PenColumn[];
};

export type StageResolution =
  | { rows: WcMatchRow[]; reveals: GameReveal[]; patch: WcRunPatch; pending?: undefined }
  | { rows: WcMatchRow[]; reveals: GameReveal[]; pending: WcPensState; patch?: undefined };

function revealFor(fixture: WCFixture, oppStrength: number, result: SingleMatchResult): GameReveal {
  return {
    label: fixture.label,
    opponent: fixture.opponent,
    oppStrength,
    goals: { you: result.goals.a, opp: result.goals.b },
    pens: result.pens ? { you: result.pens.a, opp: result.pens.b } : null,
    outcome: outcomeOf(result),
  };
}

/**
 * Resolve the run's CURRENT stage from game `fromIdx`: each game is simulated
 * deterministically and recorded. Group draws stand (league format); a LEVEL
 * KNOCKOUT GAME pauses the stage — the user takes the shootout interactively and
 * resolution resumes from the next game once it's settled.
 */
export function resolveStageFrom(
  run: WcRun, fromIdx: number, outcomesSoFar: GameOutcome[], revealsSoFar: GameReveal[]
): StageResolution {
  const fixtures = gamesForStage(run.plan, run.stage);
  const rows: WcMatchRow[] = [];
  const reveals: GameReveal[] = [];
  const outcomes = [...outcomesSoFar];

  for (let idx = fromIdx; idx < fixtures.length; idx++) {
    const fixture = fixtures[idx];
    const opp = buildOpponent(run, fixture, idx);
    const seed = `${run.seed}:match:${fixture.stage}:${idx}`;
    const result = resolveMatch(run.squad, opp.squad, seed, { allowDraw: true });
    if (result.outcome === "draw" && !allowDraw(run.stage)) {
      return {
        rows, reveals,
        pending: {
          stage: run.stage, idx,
          goals: { you: result.goals.a, opp: result.goals.b },
          outcomesSoFar: outcomes,
          revealsSoFar: [...revealsSoFar, ...reveals],
          shots: [], powers: [], dives: [],
        },
      };
    }
    rows.push(buildMatchRow(run.id, run.stage, fixture, result, opp.strength, idx));
    outcomes.push(outcomeOf(result));
    reveals.push(revealFor(fixture, opp.strength, result));
  }

  return { rows, reveals, patch: advanceStage(run, outcomes) };
}

export function resolveStage(run: WcRun): StageResolution {
  return resolveStageFrom(run, 0, [], []);
}

// ─── Interactive knockout shootout ────────────────────────────────────────────

const wcPensSeed = (run: WcRun, s: WcPensState): string =>
  pensSeed(`${run.seed}:pens:${s.stage}:${s.idx}`);

/** Replay the kicks taken so far (alternating; you are side a and kick first —
 *  you shoot your rounds, you dive against the CPU's). */
export function wcPensKicks(run: WcRun, s: WcPensState): { a: PenKick[]; b: PenKick[] } {
  const seed = wcPensSeed(run, s);
  const a: PenKick[] = [];
  const b: PenKick[] = [];
  for (;;) {
    const st = shootoutStatus(a, b, "alternating");
    if (st.decided || !st.next) break;
    if (st.next === "a") {
      const shot = s.shots[a.length];
      if (shot === undefined) break;
      a.push(resolveRound(seed, "a", a.length + 1, { shot, power: s.powers[a.length] }));
    } else {
      const dive = s.dives[b.length];
      if (dive === undefined) break;
      b.push(resolveRound(seed, "b", b.length + 1, { dive }));
    }
  }
  return { a, b };
}

export type WcPensView = {
  myKicks: PenKick[];
  oppKicks: PenKick[];
  role: "shoot" | "dive" | "done";
  suddenDeath: boolean;
  final: { outcome: "you" | "opp"; pens: { you: number; opp: number } } | null;
};

export function wcPensView(run: WcRun, s: WcPensState): WcPensView {
  const k = wcPensKicks(run, s);
  const st = shootoutStatus(k.a, k.b, "alternating");
  return {
    myKicks: k.a,
    oppKicks: k.b,
    role: st.decided ? "done" : st.next === "a" ? "shoot" : "dive",
    suddenDeath: st.suddenDeath,
    final: st.decided
      ? { outcome: st.winner === "a" ? "you" : "opp", pens: { you: st.aGoals, opp: st.bGoals } }
      : null,
  };
}

/** What the run page shows alongside the shootout (opponent chip + the 90' score). */
export function wcPensMeta(run: WcRun, s: WcPensState) {
  const fixture = gamesForStage(run.plan, s.stage)[s.idx];
  return { label: fixture.label, opponent: fixture.opponent, goals: s.goals };
}

/**
 * Settle the pending game from its inputs (submitted kicks honored verbatim,
 * anything missing seeded auto-fill), record it, then RESUME the stage from the
 * next game — which may itself pend (the 2-game ko stage) or finish the stage.
 */
export function completeWcPens(run: WcRun, s: WcPensState): StageResolution {
  const fixture = gamesForStage(run.plan, s.stage)[s.idx];
  const opp = buildOpponent(run, fixture, s.idx);
  const matchSeed = `${run.seed}:match:${s.stage}:${s.idx}`;
  const drawn = resolveMatch(run.squad, opp.squad, matchSeed, { allowDraw: true });
  const full = resolveInteractiveShootout(wcPensSeed(run, s), { aShots: s.shots, aPowers: s.powers, aDives: s.dives }, "alternating");
  const settled: SingleMatchResult = {
    ...drawn,
    outcome: full.winner === "a" ? "A" : "B",
    pens: full.score,
  };
  const row = buildMatchRow(run.id, s.stage, fixture, settled, opp.strength, s.idx);
  const reveal = revealFor(fixture, opp.strength, settled);
  const cont = resolveStageFrom(run, s.idx + 1, [...s.outcomesSoFar, outcomeOf(settled)], [...s.revealsSoFar, reveal]);
  if (cont.pending) {
    return { rows: [row, ...cont.rows], reveals: [reveal, ...cont.reveals], pending: cont.pending };
  }
  return {
    rows: [row, ...cont.rows],
    // The stage is complete — return EVERY game of the stage for the reveal overlay.
    reveals: [...s.revealsSoFar, reveal, ...cont.reveals],
    patch: cont.patch,
  };
}

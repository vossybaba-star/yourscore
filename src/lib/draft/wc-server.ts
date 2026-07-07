/**
 * 38-0 World Cup Run — server-side run logic (authoritative).
 *
 * Wires the pure run engine (wc.ts) to the data pool + match engine. The client is
 * never trusted: the nation-locked XI is re-validated and re-scored here, opponents
 * are generated server-side, and goals are resolved by the shared two-half engine.
 *
 * Drawn knockout ties (and the qualification play-off) are the player's CHOICE:
 * take an interactive penalty shootout (pens.ts) OR answer one more World Cup quiz
 * question (the decider). Both are server-authoritative. A stage in progress is held
 * in the `pens_state` column (migration 35) as a WcStageState cursor: games settled
 * so far are accumulated there, so a settled game is never re-simulated — which keeps
 * a stage that draws twice (the 2-game "ko" round) correct across mixed pens/quiz picks.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Formation, PlacedPlayer } from "./types";
import { createDraftDb, validateAndScore, GLOBAL_LEAGUE } from "./server";
import { getPlayer, getNation, isWCEligible } from "./pool";
import { deciderQuestion } from "./wc-quiz";
import { makeOpponentAt } from "./opponent";
import { resolveMatch, buildReport, type MatchSim, type SingleMatchResult } from "./live-score";
import { seededRng } from "./score";
import {
  resolveRound, shootoutStatus, resolveInteractiveShootout,
  type PenKick, type PenZone, type PenPower,
} from "./pens";
import { pensSeed } from "./pens-server";
import {
  planRun, planWorldRun, gamesForStage, buildMatchRow, outcomeOf, allowDraw, advanceStage, isDuel, oppTargetFor,
  WORLD_TEAM_NAME, RUN_STAGE_LABEL,
  type WCPlan, type WCFixture, type WcRun, type WcMatchRow, type WcRunPatch,
  type RunStage, type GameOutcome, type RunMode,
} from "./wc";
import { createServiceClient } from "@/lib/supabase/service";
import { sendFirstWcMastermindEmail } from "@/lib/email/senders";

export type { WcRun };

/** Service-role client for the World Cup tables. The draft_wc_* tables aren't in the
 *  generated DraftDatabase type yet, so we widen the client here in one place. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWcDb(): SupabaseClient<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createDraftDb() as unknown as SupabaseClient<any>;
}

/** The active ranked "edition" key (a YYYY-MM-DD string). The ranked daily keys off this
 *  instead of the UTC calendar date: the current run stays live for everyone who hasn't
 *  played it until a NEW edition is posted (rolled by scripts/draft/roll-wc-edition.mjs as
 *  part of the daily quiz launch). Falls back to today's UTC date if the singleton is unset. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function activeEdition(db: SupabaseClient<any>): Promise<string> {
  const { data } = await db.from("wc_ranked_edition").select("edition").eq("id", true).maybeSingle();
  return (data?.edition as string | undefined) ?? new Date().toISOString().slice(0, 10);
}

/** Step a YYYY-MM-DD string by `n` calendar days (UTC), returning YYYY-MM-DD. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The launch edition — the earliest ranked run_date (when the WC Mastermind first went live).
 *  It's the floor of the back-catalogue: catch-up spans from here up to today. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function firstEdition(db: SupabaseClient<any>): Promise<string | null> {
  const { data } = await db.from("draft_wc_runs")
    .select("run_date").eq("ranked", true).order("run_date", { ascending: true }).limit(1).maybeSingle();
  return (data?.run_date as string | undefined) ?? null;
}

/** Every past edition a late-joiner can catch up on: EVERY calendar day from the launch edition
 *  up to (not including) today's edition — not just days someone happened to play. Each date is
 *  a deterministic, date-seeded edition, so days that were skipped before the daily auto-roll
 *  existed (e.g. 19-20 Jun, missed when the roll lapsed) are still catchable. Most-recent first. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function pastEditions(db: SupabaseClient<any>): Promise<string[]> {
  const current = await activeEdition(db);
  const start = await firstEdition(db);
  if (!start || start >= current) return [];
  const out: string[] = [];
  for (let d = start; d < current; d = addDays(d, 1)) out.push(d);
  return out.reverse(); // most-recent first
}

/** The most-recent catchable edition (yesterday's, by the back-catalogue), or null if none.
 *  Legacy single-day catch-up path; the strip targets a specific date via catchupDate instead. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function previousEdition(db: SupabaseClient<any>): Promise<string | null> {
  const past = await pastEditions(db);
  return past[0] ?? null;
}

/** Which ranked edition a request targets: the current one, or — for a `catchup` request —
 *  the past edition the caller picked. `catchupDate` selects ANY past edition (open back-
 *  catalog); null falls back to the immediately-previous one for legacy callers. Returns null
 *  if the requested catch-up date isn't a real past edition (rejects the run). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveEdition(db: SupabaseClient<any>, catchup: boolean, catchupDate?: string | null): Promise<string | null> {
  if (!catchup) return await activeEdition(db);
  if (!catchupDate) return await previousEdition(db);
  const current = await activeEdition(db);
  if (catchupDate >= current) return null;
  const past = await pastEditions(db);
  return past.includes(catchupDate) ? catchupDate : null;
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
  const target = oppTargetFor(fixture.stage); // fixed per-round standard — NOT scaled to your Strength
  const opp = makeOpponentAt(run.formation as Formation, target, seededRng(seed));
  return { squad: opp.team.squad, strength: opp.team.strength };
}

export type GameReveal = {
  label: string;
  opponent: WCFixture["opponent"];
  oppStrength: number;
  goals: { you: number; opp: number };
  pens: { you: number; opp: number } | null;
  outcome: GameOutcome;
  decidedByQuestion?: boolean; // true when a draw was settled by the quiz decider (not pens)
};

/** A question (no correct index) sent to the client to settle a drawn tie / play-off. */
export type PublicQuestion = { id: string; prompt: string; options: string[]; category: string };

/** A drawn tie (or the play-off) awaiting the player's CHOICE — pens or quiz. */
export type PendingTie = {
  idx: number;
  stage: RunStage;
  label: string;
  opponent: WCFixture["opponent"];
  oppStrength: number;
  goals: { you: number; opp: number }; // the level 90' score (0-0 for the play-off)
  question: PublicQuestion;            // shown if the player picks the quiz route
  isPlayoff: boolean;
};

/**
 * A stage held mid-resolution in the `pens_state` column (migration 35). It accumulates
 * the games already settled in this stage (rows/outcomes/reveals) so resolution resumes
 * exactly where it stopped, plus the tie currently being decided. `pens` is non-null only
 * once the player has chosen the shootout and is taking kicks.
 */
export type WcStageState = {
  stage: RunStage;
  idx: number;                       // the game being decided
  goals: { you: number; opp: number };
  rowsSoFar: WcMatchRow[];
  outcomesSoFar: GameOutcome[];
  revealsSoFar: GameReveal[];
  pens: { shots: PenZone[]; powers: PenPower[]; dives: PenZone[] } | null;
};

export type StageResolution =
  | { kind: "resolved"; rows: WcMatchRow[]; reveals: GameReveal[]; patch: WcRunPatch }
  | { kind: "choice"; state: WcStageState; tie: PendingTie };

const publicQuestion = (q: { id: string; prompt: string; options: string[]; category: string }): PublicQuestion =>
  ({ id: q.id, prompt: q.prompt, options: q.options, category: q.category });

const deciderSeedFor = (run: WcRun, stage: RunStage, idx: number): string =>
  `${run.seed}:decider:${stage}:${idx}`;

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

const playoffFixture = (run: WcRun): WCFixture => run.plan.playoff ?? run.plan.knockouts[0];

/** The fixture for a given stage game (play-off has its own slot). */
function fixtureAt(run: WcRun, stage: RunStage, idx: number): WCFixture {
  return stage === "playoff" ? playoffFixture(run) : gamesForStage(run.plan, stage)[idx];
}

type Prior = { rows: WcMatchRow[]; outcomes: GameOutcome[]; reveals: GameReveal[] };

function finishStage(run: WcRun, prior: Prior): StageResolution {
  return { kind: "resolved", rows: prior.rows, reveals: prior.reveals, patch: advanceStage(run, prior.outcomes) };
}

/**
 * Simulate the current stage from game `fromIdx`, accumulating onto `prior` (games already
 * settled this stage). Group games are scored on points (draws stand). The first undecided
 * knockout/play-off tie PAUSES the stage and returns a `choice` carrying the cursor state +
 * the tie to settle. Everything before the pause is deterministic from the run seed.
 */
function resolveFrom(run: WcRun, fromIdx: number, prior: Prior): StageResolution {
  // Qualification play-off: no 90 minutes — a single tie from 0-0. Recorded with
  // stage='playoff' so it's a GATE (excluded from the W/D/L record + season points).
  if (run.stage === "playoff") {
    if (fromIdx > 0) return finishStage(run, prior);
    const fixture = playoffFixture(run);
    const opp = buildOpponent(run, fixture, 0);
    const q = deciderQuestion(deciderSeedFor(run, "playoff", 0));
    return {
      kind: "choice",
      state: { stage: "playoff", idx: 0, goals: { you: 0, opp: 0 }, rowsSoFar: prior.rows, outcomesSoFar: prior.outcomes, revealsSoFar: prior.reveals, pens: null },
      tie: { idx: 0, stage: "playoff", label: "Qualification Play-off", opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: 0, opp: 0 }, question: publicQuestion(q), isPlayoff: true },
    };
  }

  const fixtures = gamesForStage(run.plan, run.stage);
  const rows = [...prior.rows];
  const outcomes = [...prior.outcomes];
  const reveals = [...prior.reveals];

  for (let idx = fromIdx; idx < fixtures.length; idx++) {
    const fixture = fixtures[idx];
    const opp = buildOpponent(run, fixture, idx);
    const result = resolveMatch(run.squad, opp.squad, `${run.seed}:match:${fixture.stage}:${idx}`, { allowDraw: true });

    if (result.outcome === "draw" && !allowDraw(run.stage)) {
      const q = deciderQuestion(deciderSeedFor(run, run.stage, idx));
      return {
        kind: "choice",
        state: { stage: run.stage, idx, goals: { you: result.goals.a, opp: result.goals.b }, rowsSoFar: rows, outcomesSoFar: outcomes, revealsSoFar: reveals, pens: null },
        tie: { idx, stage: run.stage, label: fixture.label, opponent: fixture.opponent, oppStrength: opp.strength, goals: { you: result.goals.a, opp: result.goals.b }, question: publicQuestion(q), isPlayoff: false },
      };
    }

    rows.push(buildMatchRow(run.id, run.stage, fixture, result, opp.strength, idx));
    outcomes.push(outcomeOf(result));
    reveals.push(revealFor(fixture, opp.strength, result));
  }

  return finishStage(run, { rows, outcomes, reveals });
}

/** Begin resolving the run's current stage (no tie settled yet). */
export function startStage(run: WcRun): StageResolution {
  return resolveFrom(run, 0, { rows: [], outcomes: [], reveals: [] });
}

/** Settle the tie held in `state` (win/loss already determined) and resume the stage. */
function settleTie(run: WcRun, state: WcStageState, won: boolean, viaQuestion: boolean, pens: { a: number; b: number } | null): Prior {
  const fixture = fixtureAt(run, state.stage, state.idx);
  const opp = buildOpponent(run, fixture, state.idx);
  // Re-derive the 90' result (deterministic) so the stored detail matches a real game;
  // the play-off has no 90', so it's a fabricated 0-0 base.
  const base: SingleMatchResult = state.stage === "playoff"
    ? { outcome: "draw", goals: { a: 0, b: 0 }, pens: null, report: buildReport({} as MatchSim) }
    : resolveMatch(run.squad, opp.squad, `${run.seed}:match:${state.stage}:${state.idx}`, { allowDraw: true });
  const result: SingleMatchResult = { ...base, outcome: won ? "A" : "B", pens };
  const row = buildMatchRow(run.id, state.stage, fixture, result, opp.strength, state.idx);
  const reveal: GameReveal = {
    label: state.stage === "playoff" ? "Qualification Play-off" : fixture.label,
    opponent: fixture.opponent,
    oppStrength: opp.strength,
    goals: { you: result.goals.a, opp: result.goals.b },
    pens: pens ? { you: pens.a, opp: pens.b } : null,
    outcome: won ? "win" : "loss",
    ...(viaQuestion ? { decidedByQuestion: true } : {}),
  };
  return {
    rows: [...state.rowsSoFar, row],
    outcomes: [...state.outcomesSoFar, won ? "win" : "loss"],
    reveals: [...state.revealsSoFar, reveal],
  };
}

/** The player picked the QUIZ: grade their answer against the tie's decider question
 *  (server-graded — the client never gets the correct index), then resume the stage. */
export function settleByQuiz(run: WcRun, state: WcStageState, answer: number): StageResolution {
  const q = deciderQuestion(deciderSeedFor(run, state.stage, state.idx));
  const won = answer === q.correctIndex;
  return resolveFrom(run, state.idx + 1, settleTie(run, state, won, true, null));
}

/** The player picked PENS: arm the shootout sub-state (kicks come in via /wc/kick). */
export function beginPens(state: WcStageState): WcStageState {
  return { ...state, pens: { shots: [], powers: [], dives: [] } };
}

// ─── Interactive knockout shootout ────────────────────────────────────────────

const wcPensSeed = (run: WcRun, s: WcStageState): string =>
  pensSeed(`${run.seed}:pens:${s.stage}:${s.idx}`);

/** Replay the kicks taken so far (alternating; you are side a and kick first —
 *  you shoot your rounds, you dive against the CPU's). */
export function wcPensKicks(run: WcRun, s: WcStageState): { a: PenKick[]; b: PenKick[] } {
  const pens = s.pens ?? { shots: [], powers: [], dives: [] };
  const seed = wcPensSeed(run, s);
  const a: PenKick[] = [];
  const b: PenKick[] = [];
  for (;;) {
    const st = shootoutStatus(a, b, "alternating");
    if (st.decided || !st.next) break;
    if (st.next === "a") {
      const shot = pens.shots[a.length];
      if (shot === undefined) break;
      a.push(resolveRound(seed, "a", a.length + 1, { shot, power: pens.powers[a.length] }));
    } else {
      const dive = pens.dives[b.length];
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

export function wcPensView(run: WcRun, s: WcStageState): WcPensView {
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
export function wcPensMeta(run: WcRun, s: WcStageState) {
  const fixture = fixtureAt(run, s.stage, s.idx);
  return { label: s.stage === "playoff" ? "Qualification Play-off" : fixture.label, opponent: fixture.opponent, goals: s.goals };
}

/**
 * The shootout has been decided — settle the game from the kicks taken and resume the
 * stage from the next game (which may itself pend a fresh choice, or finish the stage).
 */
export function resumeAfterPens(run: WcRun, s: WcStageState): StageResolution {
  const full = resolveInteractiveShootout(
    wcPensSeed(run, s),
    { aShots: s.pens?.shots ?? [], aPowers: s.pens?.powers ?? [], aDives: s.pens?.dives ?? [] },
    "alternating",
  );
  const won = full.winner === "a";
  return resolveFrom(run, s.idx + 1, settleTie(run, s, won, false, full.score));
}

/** Rebuild the pending tie (incl. its decider question) from a persisted cursor —
 *  used to re-offer the choice when a run is reloaded mid-tie. */
export function tieFromState(run: WcRun, s: WcStageState): PendingTie {
  const fixture = fixtureAt(run, s.stage, s.idx);
  const opp = buildOpponent(run, fixture, s.idx);
  const q = deciderQuestion(deciderSeedFor(run, s.stage, s.idx));
  return {
    idx: s.idx,
    stage: s.stage,
    label: s.stage === "playoff" ? "Qualification Play-off" : fixture.label,
    opponent: fixture.opponent,
    oppStrength: opp.strength,
    goals: s.goals,
    question: publicQuestion(q),
    isPlayoff: s.stage === "playoff",
  };
}

/**
 * Persist a resolved stage and return the play/decide response. Inserts the match rows,
 * advances the run, clears any stage cursor, and (for a ranked daily run) credits each
 * game to YourScore Rank — play-off games excluded, since the play-off is a qualification gate.
 */
export async function finalizeResolved(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>, userId: string, run: WcRun, stageBefore: RunStage,
  res: Extract<StageResolution, { kind: "resolved" }>, ranked: boolean
): Promise<{ stage: RunStage; games: GameReveal[]; result: "through" | "eliminated" | "champion"; run: WcRun }> {
  if (res.rows.length > 0) await db.from("draft_wc_matches").insert(res.rows);

  const { resolved, ...runPatch } = res.patch;
  // Both modes earn upgrade picks between knockout rounds (advanceStage / STAGE_UPGRADES).
  // Each re-spin is gated on a correct WC question; a wrong answer forfeits the pick
  // (see the run page + /wc/upgrade forfeit path).
  await db.from("draft_wc_runs")
    .update({ ...runPatch, pens_state: null, updated_at: new Date().toISOString(), ...(resolved ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", run.id).eq("user_id", userId);

  if (ranked && stageBefore !== "playoff") {
    const { data: prof } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    const name = (prof?.display_name as string) ?? "Player";
    for (const g of res.reveals) {
      await db.rpc("draft_credit_result", { p_user: userId, p_name: name, p_result: g.outcome, p_league: GLOBAL_LEAGUE, p_competition: "WC" });
    }
  }

  const after = { ...run, ...runPatch };

  // First completed ranked WC Mastermind run → lifecycle email #27.
  // Fully fire-and-forget: it must NEVER block or throw into the resolution path.
  if (ranked && (after.status === "champion" || after.status === "eliminated")) {
    const runId = run.id;
    void (async () => {
      // Only the user's VERY FIRST completed ranked run (this one is already terminal above).
      const { count } = await db.from("draft_wc_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("ranked", true).in("status", ["champion", "eliminated"]);
      if ((count ?? 0) !== 1) return;
      const { data: row } = await db.from("draft_wc_runs")
        .select("strength, quiz_correct, quiz_total, stage, status")
        .eq("id", runId).maybeSingle();
      if (!row) return;
      const svc = createServiceClient();
      const { data: u } = await svc.auth.admin.getUserById(userId).catch(() => ({ data: null }));
      const email = u?.user?.email;
      if (!email) return;
      // World rank from the season board (best-effort — same source as the scorecard).
      let worldRank: number | null = null;
      try {
        const { data: lb } = await db.rpc("get_wc_daily_leaderboard", {
          p_start: "2026-06-11", p_end: "2026-07-19", p_limit: 100000,
        });
        worldRank = ((lb ?? []) as { user_id: string; rank: number }[])
          .find((x) => x.user_id === userId)?.rank ?? null;
      } catch { /* board not ready yet */ }
      const result = row.status === "champion"
        ? "Final, and lifted it"
        : (RUN_STAGE_LABEL[row.stage as RunStage] ?? "Group Stage");
      await sendFirstWcMastermindEmail({
        userId, email,
        overall: Number(row.strength),
        quizCorrect: (row.quiz_correct as number | null) ?? null,
        quizTotal: (row.quiz_total as number | null) ?? null,
        result, worldRank,
      });
    })().catch(() => {});
  }

  return {
    stage: stageBefore,
    games: res.reveals,
    result: after.status === "champion" ? "champion" : after.status === "eliminated" ? "eliminated" : "through",
    run: after,
  };
}

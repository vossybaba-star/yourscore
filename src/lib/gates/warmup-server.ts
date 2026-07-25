/**
 * YourScore Fantasy Football warm-up — server-authoritative question layer.
 *
 * The warm-up game (post-WC funnel): 11 gate questions, one per XI slot; a
 * correct answer (and a live streak) raises the band the player drafts from —
 * the WC Mastermind mechanic over OUR generated gate pool.
 *
 * Stateless by design: a round is fully determined by (pool.version, session
 * key), so grading just rebuilds it — no DB rows for an anonymous 2-minute
 * funnel game. The client never receives answerIds; it posts its picks and the
 * server reveals correctness + the band per step. (Unranked: a determined
 * cheat could replay a key — acceptable for the funnel; the ranked product
 * uses the server-secret-seed path in wc-draft.ts.)
 */

import "server-only";
import poolJson from "@/data/gates/pool.json";
import type { GateQuestion } from "./types";
import { buildRound, clientView, grade, type Round, type ServedQuestion } from "./serve";

/** A current-season player as exposed for the "26/27" warm-up mode (no answers here). */
export interface CurrentPlayer {
  id: number;
  name: string;
  club: string;
  clubId: number;
  position: "GK" | "DEF" | "MID" | "FWD";
  price: number;
}

const POOL = poolJson as unknown as {
  version: string;
  builtAt: string;
  questions: GateQuestion[];
  currentPlayers?: CurrentPlayer[];
};

export const WARMUP_FORMATION = "4-3-3";

/** The pool version — echoed to the client so a stale round can restart cleanly. */
export function poolVersion(): string {
  return POOL.version;
}

function roundFor(sessionKey: string): Round {
  return buildRound(POOL.questions, {
    gameweek: `warmup:${POOL.version}`,
    userId: sessionKey,
    formation: WARMUP_FORMATION,
  });
}

/** The 11 served questions for this session (no answers) + the current-player
 *  list that powers the "26/27 season" draft mode. */
export function warmupQuestions(sessionKey: string): {
  version: string;
  questions: ServedQuestion[];
  currentPlayers: CurrentPlayer[];
} {
  return {
    version: POOL.version,
    questions: clientView(roundFor(sessionKey)),
    currentPlayers: POOL.currentPlayers ?? [],
  };
}

// Grants live in warmup-economy.ts with prices (pure, no pool import) — shared
// with the page and the measurement script so balance numbers are measured, not
// estimated.
import { grantFor, milestoneBonus } from "./warmup-economy";

export interface WarmupStep {
  correct: boolean;
  /** The right option id — safe to reveal once this question is answered. */
  answerId: number;
  streak: number;
  /** £m added to the player's draft budget for this pick (incl. any milestone). */
  grant: number;
  /** Set when this answer crossed a scouting milestone (9 or 11 total correct). */
  milestone?: number;
}

/**
 * Grade answers[0..k] (option ids, null = timeout/skip) and fold them through
 * the streak logic. Returns the state AFTER answer k, including that answer's
 * budget grant. Null = the round is stale (pool rebuilt) or the input is
 * invalid → client restarts.
 */
export function warmupStep(
  sessionKey: string,
  version: string,
  answers: readonly (number | null)[],
  k: number,
): WarmupStep | null {
  if (version !== POOL.version) return null;
  if (k < 0 || k >= answers.length) return null;
  const round = roundFor(sessionKey);
  if (k >= round.questions.length) return null;

  let streak = 0;
  let lastCorrect = false;
  let totalCorrect = 0;
  for (let j = 0; j <= k; j++) {
    const a = answers[j];
    let correct = false;
    if (a !== null) {
      const g = grade(round, j, a);
      if (g === null && j === k) return null; // invalid option for the graded step
      correct = g?.correct ?? false;
    }
    streak = correct ? streak + 1 : 0;
    if (correct) totalCorrect++;
    lastCorrect = correct;
  }
  const bonus = lastCorrect ? milestoneBonus(totalCorrect - 1, totalCorrect) : 0;
  return {
    correct: lastCorrect,
    answerId: round.questions[k].answerId,
    streak,
    grant: grantFor(lastCorrect, streak) + bonus,
    ...(bonus > 0 ? { milestone: totalCorrect } : {}),
  };
}

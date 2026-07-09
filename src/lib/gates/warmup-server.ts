/**
 * Your PL XI warm-up — server-authoritative question layer.
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

// Budget grants (£m, tunable). Calibrated against what a DEAL can actually sell
// you (founder, round 2): a random club's best option at one position usually
// tops out ~£6–8, so grants must sit near that — not near the £15 superstar
// ceiling — or a good quizzer banks £50m of dead money and maxes every pick.
// Targets: perfect round ≈ £72 earned vs ~£77 to max every deal (even
// perfection forces a compromise or two); 8/11 ≈ £58 (constant choices);
// all-wrong ≈ £44 (scrimping, stretch-buy safety net still applies).
export const GRANT_CORRECT = 6;
export const GRANT_WRONG = 4; // = the cheapest player's price: never stranded, zero slack
export const GRANT_STREAK_BONUS = 0.5; // per consecutive correct beyond the first…
export const GRANT_STREAK_CAP = 2; // …capped at +£1 (2 steps)

/** The budget grant (£m) for an answer given the streak AFTER it. */
export function grantFor(correct: boolean, streak: number): number {
  if (!correct) return GRANT_WRONG;
  const bonus = Math.min(GRANT_STREAK_CAP, Math.max(0, streak - 1)) * GRANT_STREAK_BONUS;
  return Math.round((GRANT_CORRECT + bonus) * 10) / 10;
}

export interface WarmupStep {
  correct: boolean;
  /** The right option id — safe to reveal once this question is answered. */
  answerId: number;
  streak: number;
  /** £m added to the player's draft budget for this pick. */
  grant: number;
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
  for (let j = 0; j <= k; j++) {
    const a = answers[j];
    let correct = false;
    if (a !== null) {
      const g = grade(round, j, a);
      if (g === null && j === k) return null; // invalid option for the graded step
      correct = g?.correct ?? false;
    }
    streak = correct ? streak + 1 : 0;
    lastCorrect = correct;
  }
  return {
    correct: lastCorrect,
    answerId: round.questions[k].answerId,
    streak,
    grant: grantFor(lastCorrect, streak),
  };
}

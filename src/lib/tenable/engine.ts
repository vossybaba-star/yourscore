/**
 * Football Tenable — pure engine.
 *
 * No React, no I/O — all matching, lives and scoring logic lives here so it can
 * be unit-tested and later reused by a server-authoritative grader (the same way
 * 38-0's match engine is a pure lib re-run on the server).
 */

import type { TenableAnswer, TenableBoard, GuessOutcome, TenableState } from "./types";

export const STARTING_LIVES = 5;
export const BOARD_SIZE = 10;

// ── Scoring knobs ───────────────────────────────────────────────────────────
// Chosen to spread a shared-seed leaderboard: finding answers is the bulk of the
// score, but surviving lives is rewarded so two players on the same X/10 separate
// by how cleanly they got there. A perfect board pays a celebration bonus.
export const POINTS_PER_ANSWER = 1000;
export const POINTS_PER_LIFE = 500;
export const PERFECT_BONUS = 2500;

// ── Normalization & matching ────────────────────────────────────────────────

/** Lowercase, strip accents, collapse punctuation/whitespace. */
export function normalize(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pre-normalized accept-set for one answer (canonical label always included). */
function acceptSet(answer: TenableAnswer): Set<string> {
  const set = new Set<string>();
  set.add(normalize(answer.label));
  for (const a of answer.accept) set.add(normalize(a));
  return set;
}

/**
 * Find which board answer (if any) a raw guess matches. Returns the answer or
 * null. Exact normalized match against the accept-set — deliberately strict so
 * the game stays fair (no fuzzy false-positives), but generous via aliases.
 */
export function matchGuess(board: TenableBoard, raw: string): TenableAnswer | null {
  const guess = normalize(raw);
  if (!guess) return null;
  for (const answer of board.answers) {
    if (acceptSet(answer).has(guess)) return answer;
  }
  return null;
}

// ── State ───────────────────────────────────────────────────────────────────

export function initState(): TenableState {
  return { foundRanks: [], lives: STARTING_LIVES, misses: [], status: "playing" };
}

/**
 * Apply a guess to the state. Pure: returns the next state plus the outcome so
 * the UI can animate the reveal / life loss. Once the round is over (won/lost),
 * further guesses are ignored.
 */
export function applyGuess(
  board: TenableBoard,
  state: TenableState,
  raw: string
): { state: TenableState; outcome: GuessOutcome } {
  if (state.status !== "playing") return { state, outcome: { kind: "empty" } };
  if (!normalize(raw)) return { state, outcome: { kind: "empty" } };

  const matched = matchGuess(board, raw);

  if (matched) {
    if (state.foundRanks.includes(matched.rank)) {
      // Already found — no penalty, gentle nudge.
      return { state, outcome: { kind: "duplicate", answer: matched } };
    }
    const foundRanks = [...state.foundRanks, matched.rank];
    const status = foundRanks.length === BOARD_SIZE ? "won" : "playing";
    return {
      state: { ...state, foundRanks, status },
      outcome: { kind: "hit", answer: matched },
    };
  }

  // Miss — lose a life.
  const lives = state.lives - 1;
  const status = lives <= 0 ? "lost" : "playing";
  return {
    state: { ...state, lives, misses: [...state.misses, raw.trim()], status },
    outcome: { kind: "miss" },
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export interface TenableScore {
  found: number; //         answers found (0–10) — the headline share state
  livesLeft: number;
  answerPoints: number;
  lifePoints: number;
  perfectBonus: number;
  total: number;
  perfect: boolean;
}

export function scoreBoard(state: TenableState): TenableScore {
  const found = state.foundRanks.length;
  const perfect = found === BOARD_SIZE;
  const answerPoints = found * POINTS_PER_ANSWER;
  // Lives only bank if you actually completed the board cleanly is too harsh —
  // reward surviving lives regardless, so accuracy always counts.
  const lifePoints = state.lives * POINTS_PER_LIFE;
  const perfectBonus = perfect ? PERFECT_BONUS : 0;
  return {
    found,
    livesLeft: state.lives,
    answerPoints,
    lifePoints,
    perfectBonus,
    total: answerPoints + lifePoints + perfectBonus,
    perfect,
  };
}

/** "You beat LukePingu" verdict — by answers found, then by total as a tiebreak. */
export function beatLuke(found: number, lukeScore: number): "beat" | "tied" | "lost" {
  if (found > lukeScore) return "beat";
  if (found === lukeScore) return "tied";
  return "lost";
}

/** The answers in rank order, with whether the player found each (for reveal). */
export function revealRows(board: TenableBoard, state: TenableState) {
  return [...board.answers]
    .sort((a, b) => a.rank - b.rank)
    .map((answer) => ({ answer, found: state.foundRanks.includes(answer.rank) }));
}

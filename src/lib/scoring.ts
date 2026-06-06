/**
 * YourScore Scoring Engine — v2
 *
 * Formula per correct question:  BASE × difficulty_multiplier × speed_multiplier
 * Base: 100 pts
 *
 * Difficulty multipliers:
 *   easy   ×1.0  → max 200 pts/question (Lightning)
 *   medium ×1.5  → max 300 pts/question
 *   hard   ×2.0  → max 400 pts/question
 *   expert ×2.5  → max 500 pts/question
 *   master ×3.0  → max 600 pts/question
 *
 * Speed multipliers — percentage-based bands (relative to available question window):
 *   0–20%  of window  Lightning  ×2.00
 *  20–40%             Fast       ×1.50
 *  40–60%             Normal     ×1.00
 *  60–80%             Slow       ×0.75
 *  80–100%            Very Slow  ×0.50
 *  No answer (timer expired without submit) → Timeout → 0 pts + −25 penalty
 *
 * This means a 20s question's Lightning band is 0–4 s; a 45s question's is 0–9 s.
 * Pass the actual question window so bands scale correctly across game modes.
 */

export const BASE_POINTS = 100;

/** Default question window when no explicit window is known (e.g. solo challenges). */
export const DEFAULT_QUESTION_WINDOW_MS = 30_000;

/** Per-question window for head-to-head challenges. Shared by the H2H client
 *  (live score preview) and /api/h2h/play (authoritative grade) so they match. */
export const H2H_QUESTION_WINDOW_MS = 20_000;

export const DIFFICULTY_MULT: Record<string, number> = {
  easy:   1.0,
  medium: 1.5,
  hard:   2.0,
  expert: 2.5,
  master: 3.0,
};

/**
 * Speed tiers defined as percentage of available question window.
 * maxPct is the upper bound (inclusive) of each band.
 * The Timeout tier (pct > 1.0) is only reached when a player does NOT answer;
 * answered questions are always capped at Very Slow (0.50) at minimum.
 */
export const SPEED_TIERS = [
  { maxPct: 0.20, mult: 2.00, label: "⚡ Lightning" },
  { maxPct: 0.40, mult: 1.50, label: "🚀 Fast"      },
  { maxPct: 0.60, mult: 1.00, label: "✅ Normal"    },
  { maxPct: 0.80, mult: 0.75, label: "🐢 Slow"      },
  { maxPct: 1.00, mult: 0.50, label: "🐌 Very Slow" },
  { maxPct: Infinity, mult: 0.00, label: "⌛ Timeout" },
] as const;

// ─── Multiplier helpers ────────────────────────────────────────────────────

export function getDifficultyMultiplier(difficulty: string): number {
  return DIFFICULTY_MULT[difficulty?.toLowerCase()] ?? 1.0;
}

/**
 * Returns the speed multiplier for an answer.
 * @param elapsedMs   Time from question display to answer submission (ms).
 * @param windowMs    Total time available for the question (ms).
 *                    Defaults to DEFAULT_QUESTION_WINDOW_MS if omitted.
 *
 * Actual answers are capped at Very Slow (×0.50) — the Timeout tier (×0.00)
 * is only applied externally for players who never submitted.
 */
export function getSpeedMultiplier(elapsedMs: number, windowMs = DEFAULT_QUESTION_WINDOW_MS): number {
  if (windowMs <= 0) return 1.0;
  // Cap at 0.9999 so an actual answer always scores at least Very Slow (×0.50).
  const pct = Math.min(Math.max(0, elapsedMs) / windowMs, 0.9999);
  for (const tier of SPEED_TIERS) {
    if (pct <= tier.maxPct) return tier.mult;
  }
  return 0.50; // fallback: Very Slow
}

/**
 * Human-readable speed label for an answer.
 * @param elapsedMs  Time from question display to answer (ms).
 * @param windowMs   Total available time for the question (ms).
 */
export function getSpeedLabel(elapsedMs: number, windowMs = DEFAULT_QUESTION_WINDOW_MS): string {
  if (windowMs <= 0) return "✅ Normal";
  const pct = Math.min(Math.max(0, elapsedMs) / windowMs, 0.9999);
  for (const tier of SPEED_TIERS) {
    if (pct <= tier.maxPct) return tier.label;
  }
  return "🐌 Very Slow";
}

// ─── Per-question score ────────────────────────────────────────────────────

/**
 * Base score for one question (0 if wrong).
 * @param isCorrect  Whether the player's answer was correct.
 * @param elapsedMs  Time from question display to answer submission (ms).
 * @param difficulty Question difficulty string (easy / medium / hard / expert / master).
 * @param windowMs   Total available time for the question (ms). Defaults to 30 s.
 */
export function calculateBasePoints(
  isCorrect: boolean,
  elapsedMs: number,
  difficulty: string,
  windowMs = DEFAULT_QUESTION_WINDOW_MS
): number {
  if (!isCorrect) return 0;
  return Math.round(
    BASE_POINTS * getDifficultyMultiplier(difficulty) * getSpeedMultiplier(elapsedMs, windowMs)
  );
}

/** Theoretical max for a question at given difficulty (Lightning speed). */
export function maxPointsForDifficulty(difficulty: string): number {
  return Math.round(BASE_POINTS * getDifficultyMultiplier(difficulty) * 2.0);
}

// ─── Per-question bonuses ──────────────────────────────────────────────────

/** +50 when player has ≥ 2 consecutive correct answers and gets this one right. */
export function calculateStreakBonus(currentStreak: number, isCorrect: boolean): number {
  if (!isCorrect || currentStreak < 2) return 0;
  return 50;
}

/** +50 when player corrects after ≥ 3 consecutive wrong answers (comeback). */
export function calculateComebackBonus(wrongStreak: number, isCorrect: boolean): number {
  if (!isCorrect || wrongStreak < 3) return 0;
  return 50;
}

// ─── Round-end bonuses ─────────────────────────────────────────────────────

/** +500 if every question in the round was answered correctly. */
export function calculatePerfectRoundBonus(correctCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return correctCount === totalCount ? 500 : 0;
}

/** +75 if zero hints used in the round (deferred until hint system ships). */
export function calculateNoHintsBonus(hintsUsed: number): number {
  return hintsUsed === 0 ? 75 : 0;
}

// ─── Penalties ─────────────────────────────────────────────────────────────

/** -25 when a question timer expires with no answer submitted. */
export const TIMEOUT_PENALTY = -25;

/** -50 per hint or skip used. */
export const HINT_PENALTY = -50;

/** -100 for abandoning a round mid-game. */
export const RAGEQUIT_PENALTY = -100;

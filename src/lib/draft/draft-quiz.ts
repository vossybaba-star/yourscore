/**
 * Quiz-gated draft quality (World Cup draft).
 *
 * Before each spin the player answers a World Cup quiz question. A correct answer
 * raises the overall band the spin deals from — and a consecutive-correct STREAK
 * escalates it further (capped). A wrong answer caps the spin below elite quality and
 * removes the floor. So the more football you know, the stronger your XI — and the
 * better your shot at going unbeaten.
 *
 * Pure + dependency-free so it runs under `node --test`.
 */

/** The overall-rating window a spin should deal from. `spinForNation` / `spinWorld`
 *  treat these as soft bounds (relaxed if a nation lacks depth) so a player can never
 *  dead-end on a position. */
export type DraftBand = { minOverall: number; maxOverall: number };

/** Result of answering one gating question, with the streak AFTER this answer. */
export type QuizGrade = { correct: boolean; streak: number };

// Tunables. The pool spans ~40–93 overall.
export const QUIZ_BASE_FLOOR = 66;   // floor for a single correct answer (streak 1)
export const QUIZ_STREAK_STEP = 3;   // floor gained per extra consecutive correct
export const QUIZ_FLOOR_CAP = 84;    // floor never exceeds this (elite stays a spin, not a guarantee)
export const QUIZ_WRONG_CEILING = 72; // a wrong answer can't deal an elite player

/** Advance a correct-streak: +1 on a correct answer, reset to 0 on a miss. */
export function nextStreak(prev: number, correct: boolean): number {
  return correct ? prev + 1 : 0;
}

/**
 * The spin band for an answered question. Correct → high floor (rising with the
 * streak), elite ceiling. Wrong → no floor, sub-elite ceiling. The streak passed is
 * the value AFTER this answer (so the first correct answer is streak 1).
 */
export function bandForGrade(grade: QuizGrade): DraftBand {
  if (!grade.correct) return { minOverall: 0, maxOverall: QUIZ_WRONG_CEILING };
  const steps = Math.max(0, grade.streak - 1);
  const floor = Math.min(QUIZ_FLOOR_CAP, QUIZ_BASE_FLOOR + steps * QUIZ_STREAK_STEP);
  return { minOverall: floor, maxOverall: 99 };
}

/** One-call helper: given the previous streak and this answer's correctness, return
 *  the new streak and the band to spin with. */
export function gradeAnswer(prevStreak: number, correct: boolean): { streak: number; band: DraftBand } {
  const streak = nextStreak(prevStreak, correct);
  return { streak, band: bandForGrade({ correct, streak }) };
}

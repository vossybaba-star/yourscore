/**
 * Serving layer — turns the generated pool into a per-user round.
 *
 * Anti-cheat by construction:
 * - Every user gets a DIFFERENT seeded subset per gameweek (seed = gw:user), so
 *   there's no shared answer key to post in the group chat.
 * - The client only ever sees ServedQuestion (answerId stripped); grading is
 *   server-side against the full round.
 *
 * The layer is pure (no DB, no Date) — the API route owns persistence. Budget
 * weighting: a correct answer pays base × (1 + difficulty/100), so harder
 * questions earn more — but the user never CHOOSES difficulty (that invites
 * cheating); the round just mixes easy → hard.
 */

import type { GateQuestion, Position } from "./types";
import { seededRng, shuffle } from "./rng";

/** What the client is allowed to see. NO answerId, NO meta. */
export interface ServedQuestion {
  idx: number; // stable index into the round (the grading key)
  format: GateQuestion["format"];
  prompt: string;
  options: { id: number; label: string }[];
  position: Position; // which XI slot this gates (warm-up per-position flow)
}

/** The server-held round (persist this; never send it to the client). */
export interface Round {
  seed: string;
  questions: GateQuestion[]; // full, with answers
  positions: Position[]; // slot list the round was built for
}

/** Formation slot list, e.g. 4-3-3 → [GK, DEF×4, MID×3, FWD×3]. */
export function formationSlots(formation: string): Position[] {
  const m = formation.match(/^(\d)-(\d)-(\d)$/);
  const def = m ? parseInt(m[1], 10) : 4;
  const mid = m ? parseInt(m[2], 10) : 3;
  const fwd = m ? parseInt(m[3], 10) : 3;
  const out: Position[] = ["GK"];
  for (let i = 0; i < def; i++) out.push("DEF");
  for (let i = 0; i < mid; i++) out.push("MID");
  for (let i = 0; i < fwd; i++) out.push("FWD");
  return out;
}

/**
 * Build a per-user round: one question per slot, position-matched, no player
 * reused as an answer across the round, difficulty mixed easy→hard within each
 * position so early picks warm the user up.
 */
export function buildRound(
  pool: readonly GateQuestion[],
  opts: { gameweek: string; userId: string; formation?: string },
): Round {
  const positions = formationSlots(opts.formation ?? "4-3-3");
  const seed = `${opts.gameweek}:${opts.userId}`;
  const rand = seededRng(seed);

  // Group + shuffle the pool per position (a question tagged with several
  // positions is eligible for each).
  const byPos = new Map<Position, GateQuestion[]>();
  for (const pos of ["GK", "DEF", "MID", "FWD"] as Position[]) {
    const qs = pool.filter((q) => q.positions.includes(pos));
    byPos.set(pos, shuffle(qs, rand));
  }

  const usedAnswers = new Set<number>();
  const usedPrompts = new Set<string>();
  const picked: { q: GateQuestion; pos: Position }[] = [];
  const slotCount = new Map<Position, number>();
  for (const pos of positions) slotCount.set(pos, (slotCount.get(pos) ?? 0) + 1);

  for (const [pos, n] of slotCount) {
    const eligible = byPos.get(pos) ?? [];
    const chosen: GateQuestion[] = [];
    for (const q of eligible) {
      if (chosen.length >= n) break;
      if (usedAnswers.has(q.answerId) || usedPrompts.has(q.prompt)) continue;
      chosen.push(q);
      usedAnswers.add(q.answerId);
      usedPrompts.add(q.prompt);
    }
    // Within a position, serve easiest first (warm-up curve).
    chosen.sort((a, b) => a.difficulty - b.difficulty);
    for (const q of chosen) picked.push({ q, pos });
  }

  // Order the round by slot order (GK → DEF → MID → FWD), which the position
  // grouping above already yields; flatten to the final list.
  return { seed, questions: picked.map((p) => p.q), positions };
}

/** Client-safe view of a round — answers + meta stripped. */
export function clientView(round: Round): ServedQuestion[] {
  return round.questions.map((q, idx) => ({
    idx,
    format: q.format,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, label: o.label })),
    position: round.positions[idx] ?? q.positions[0] ?? "MID",
  }));
}

/** Grade one answer server-side. */
export function grade(
  round: Round,
  idx: number,
  optionId: number,
): { correct: boolean; difficulty: number } | null {
  const q = round.questions[idx];
  if (!q) return null;
  if (!q.options.some((o) => o.id === optionId)) return null; // not an offered option
  return { correct: optionId === q.answerId, difficulty: q.difficulty };
}

/** Budget weight for a correct answer: 1.0 (easiest) → 2.0 (hardest). */
export function budgetWeight(difficulty: number): number {
  const d = Math.max(0, Math.min(100, difficulty));
  return 1 + d / 100;
}

/**
 * Total budget for a set of graded answers. `base` is the per-correct budget
 * unit (the game layer's tuning dial); wrong answers pay nothing.
 */
export function roundBudget(
  results: readonly { correct: boolean; difficulty: number }[],
  base: number,
): number {
  let total = 0;
  for (const r of results) if (r.correct) total += base * budgetWeight(r.difficulty);
  return Math.round(total * 10) / 10;
}

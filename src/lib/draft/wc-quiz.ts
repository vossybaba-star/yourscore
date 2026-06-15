/**
 * World Cup quiz pool — questions that gate draft quality in the World Cup draft.
 *
 * The pool is bundled at build time from the WC daily-quiz series
 * (src/data/draft/wc-quiz.json, produced by scripts/draft/build-wc-quiz.mjs) so there
 * are no runtime fs reads. Each question is stored in canonical A–D order with the
 * correct index; `drawQuestion` re-shuffles the options per serve so the answer is
 * never in a fixed slot.
 */

import bundle from "@/data/draft/wc-quiz.json";

/** A question as stored in the bundle (canonical option order, `answer` = index). */
export type WCQuizQuestion = {
  id: string;
  q: string;
  options: string[];
  answer: number;
  difficulty: string;
  category: string;
};

/** A question prepared for display: options shuffled, correct slot tracked. */
export type ServedQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  category: string;
};

const POOL = (bundle as { questions: WCQuizQuestion[] }).questions;

/** How many distinct WC questions exist (for "you've answered N/M" style copy). */
export const WC_QUIZ_COUNT = POOL.length;

/**
 * Draw one question, shuffling its options. `exclude` holds ids already asked this
 * draft so a single team-build doesn't repeat a question — until the pool is
 * exhausted, after which repeats are allowed (so a long run never dead-ends).
 */
export function drawQuestion(rng: () => number = Math.random, exclude: Set<string> = new Set()): ServedQuestion | null {
  if (POOL.length === 0) return null;
  const avail = POOL.filter((qn) => !exclude.has(qn.id));
  const src = avail.length ? avail : POOL;
  const base = src[Math.floor(rng() * src.length)];
  const order = base.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    id: base.id,
    prompt: base.q,
    options: order.map((i) => base.options[i]),
    correctIndex: order.indexOf(base.answer),
    category: base.category,
  };
}

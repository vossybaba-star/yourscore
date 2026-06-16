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
import { seededRng } from "./score";

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
  return serve(src[Math.floor(rng() * src.length)], rng);
}

/** Prepare a stored question for display: shuffle its options, track the correct slot. */
function serve(base: WCQuizQuestion, rng: () => number): ServedQuestion {
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

/**
 * A deterministic decider question from a seed (e.g. `${runSeed}:decider:qf:0`) — used to
 * settle a drawn knockout tie or the qualification play-off in place of a penalty shootout.
 * Deterministic so the server can re-derive the same question (and grade the answer) on the
 * follow-up submit without persisting it. Keeps `correctIndex` — callers strip it before
 * sending to the client.
 */
export function deciderQuestion(seed: string): ServedQuestion {
  const rng = seededRng(seed);
  return serve(POOL[Math.floor(rng() * POOL.length)], rng);
}

/**
 * The fixed set of `count` questions for a ranked daily run, drawn at random from the
 * **entire World Cup question bank** (every dated pack in the bundle, not just today's),
 * **seeded by date** so every player faces the same questions in the same order that day
 * (the "same test" rule) while the set still rotates day to day. Options are shuffled
 * deterministically too. Practice runs use `drawQuestion` instead — also the whole bank,
 * but freshly random each play.
 */
export function dailyQuestions(date: string, count = 11): ServedQuestion[] {
  const rng = seededRng(`wc-daily:${date}`);
  const arr = POOL.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count).map((q) => serve(q, rng));
}

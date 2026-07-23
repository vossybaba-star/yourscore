/**
 * Premier League quiz pool — the questions that gate draft quality in 38-0's PL Pro mode.
 *
 * The pool is bundled at build time from an approved slice of the `questions` bank
 * (src/data/draft/pl-quiz.json, produced by scripts/draft/build-pl-quiz.mjs) so there are
 * no runtime DB reads. Each question is stored in canonical A–D order with the correct
 * index; `gateQuestion` re-shuffles the options per serve so the answer is never in a
 * fixed slot.
 *
 * SERVER-ONLY, for the same reason as wc-quiz.ts (audit C1): this module carries every
 * answer. Bundling it client-side would let anyone read the answer to the question they
 * were just asked. Clients get questions through /api/draft/pl/gate-quiz; the types they
 * need live in wc-quiz-public.ts (shared — the shape is identical).
 *
 * Unlike the World Cup gate there is NO `dailyQuestions` here. PL Pro is replayable, not
 * a dated daily competition, so there is no same-test-for-everyone rule to honour.
 */

import "server-only";
import bundle from "@/data/draft/pl-quiz.json";
import { seededRng } from "./score";
import type { ServedQuestion } from "./wc-quiz-public";

/** A question as stored in the bundle (canonical option order, `answer` = index). */
export type PLQuizQuestion = {
  id: string;
  q: string;
  options: string[];
  answer: number;
  difficulty: string;
  category: string;
  /** Which club (or "Premier League Records") the question was filed under in the bank. */
  entity: string;
};

const POOL = (bundle as { questions: PLQuizQuestion[] }).questions;

/** How many distinct PL gate questions exist. */
export const PL_QUIZ_COUNT = POOL.length;

/** Prepare a stored question for display: shuffle its options, track the correct slot. */
function serve(base: PLQuizQuestion, rng: () => number): ServedQuestion {
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
 * The gate question for a seed. Deterministic, so the server can re-derive the same
 * question (and grade the answer) on the follow-up call without persisting anything —
 * the same trick the WC practice quiz and tie-deciders use. Callers strip `correctIndex`
 * before sending to the client and reveal it only after the answer is locked.
 */
export function gateQuestion(seed: string): ServedQuestion {
  const rng = seededRng(seed);
  return serve(POOL[Math.floor(rng() * POOL.length)], rng);
}

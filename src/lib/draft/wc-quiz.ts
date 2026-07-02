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
 * The fixed set of `count` questions for a ranked daily run, drawn from the **entire World
 * Cup question bank** (every dated pack in the bundle) but **weighted toward recent events**:
 * a question from a pack nearer the run date is far more likely to be picked, while older
 * questions keep a floor weight so whole-tournament knowledge still counts. **Seeded by date**
 * so every player faces the same questions in the same order that day (the "same test" rule)
 * while the set rotates day to day. Deterministic (static pool + fixed reference date), so the
 * server re-derives the identical set on every slate/submit call. Options are shuffled
 * deterministically too. Practice runs use `drawQuestion` instead — the whole bank, freshly
 * random (and unweighted) each play.
 */
export function dailyQuestions(date: string, count = 11): ServedQuestion[] {
  const rng = seededRng(`wc-daily:${date}`);
  const ref = Date.parse(`${date}T00:00:00Z`);
  const dateOf = (q: WCQuizQuestion) => Date.parse(`${q.id.slice(0, 10)}T00:00:00Z`);
  // Only questions from packs on/before the run date are eligible, so neither today's run nor a
  // past catch-up run surfaces events that hadn't happened yet. Fall back to the whole bank if
  // that leaves too few (very early in the tournament).
  const eligible = Number.isFinite(ref)
    ? POOL.filter((q) => { const d = dateOf(q); return !Number.isFinite(d) || d <= ref; })
    : POOL;
  const src = eligible.length >= count ? eligible : POOL;
  // Recency weight: exponential decay by how many days before the run date the pack landed,
  // plus a floor so older questions never drop out entirely (~8-day time constant).
  const weightOf = (q: WCQuizQuestion): number => {
    const qd = dateOf(q);
    if (!Number.isFinite(qd) || !Number.isFinite(ref)) return 1;
    const daysAgo = Math.max(0, (ref - qd) / 86_400_000);
    return Math.exp(-daysAgo / 8) + 0.12;
  };
  // Weighted sampling without replacement, seeded by date.
  const pool = src.map((q) => ({ q, w: weightOf(q) }));
  const picked: WCQuizQuestion[] = [];
  for (let n = 0; n < count && pool.length > 0; n++) {
    let total = 0;
    for (const e of pool) total += e.w;
    let r = rng() * total;
    let idx = 0;
    while (idx < pool.length - 1 && r > pool[idx].w) { r -= pool[idx].w; idx++; }
    picked.push(pool[idx].q);
    pool.splice(idx, 1);
  }
  return picked.map((q) => serve(q, rng));
}

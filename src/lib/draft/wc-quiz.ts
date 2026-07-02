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
 * The `count` questions for a ranked daily run — **a genuine daily game**. Each edition is
 * **anchored to its own day's pack**, so a player replaying a past day sees *that day's* World
 * Cup, not a recycled or cross-tournament mix. When a day's own pack is short of `count` (a
 * missing or small day), the remainder is **backfilled with the most recent PRIOR questions**
 * (recency-weighted) so a run always fills — and a pack dated after the run date is never used.
 * **Seeded by date** so every player faces the same questions in the same order that day (the
 * "same test" rule) while each day is its own set. Deterministic (static pool + fixed date),
 * so the server re-derives the identical set on every slate/submit call. Options are shuffled
 * deterministically too. Practice runs use `drawQuestion` instead — the whole bank, freshly
 * random each play.
 */
export function dailyQuestions(date: string, count = 11): ServedQuestion[] {
  const rng = seededRng(`wc-daily:${date}`);
  const ref = Date.parse(`${date}T00:00:00Z`);
  const dayKey = (q: WCQuizQuestion) => q.id.slice(0, 10);
  const dateMs = (q: WCQuizQuestion) => Date.parse(`${dayKey(q)}T00:00:00Z`);
  const seededShuffle = <T>(arr: T[]): T[] => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // 1. Anchor to this day's own questions.
  const own = Number.isFinite(ref) ? POOL.filter((q) => dayKey(q) === date) : [];
  const picked: WCQuizQuestion[] = seededShuffle(own).slice(0, count);

  // 2. Backfill (only if the day is short): most-recent PRIOR questions, recency-weighted.
  if (picked.length < count && Number.isFinite(ref)) {
    const chosen = new Set(picked);
    const bag = POOL
      .filter((q) => { const d = dateMs(q); return Number.isFinite(d) && d < ref && !chosen.has(q); })
      .map((q) => ({ q, w: Math.exp(-Math.max(0, (ref - dateMs(q)) / 86_400_000) / 8) + 0.12 }));
    while (picked.length < count && bag.length > 0) {
      let total = 0; for (const e of bag) total += e.w;
      let r = rng() * total, idx = 0;
      while (idx < bag.length - 1 && r > bag[idx].w) { r -= bag[idx].w; idx++; }
      picked.push(bag[idx].q); bag.splice(idx, 1);
    }
  }

  // 3. Last-ditch pad (empty/very early edition) so a run never dead-ends.
  if (picked.length < count) {
    const chosen = new Set(picked);
    for (const q of seededShuffle(POOL)) { if (picked.length >= count) break; if (!chosen.has(q)) picked.push(q); }
  }

  return picked.map((q) => serve(q, rng));
}

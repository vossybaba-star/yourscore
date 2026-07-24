/**
 * Deterministic option shuffling at publish time.
 *
 * Authors — human and model alike — tend to write the correct answer as option A every
 * time. The challenge page renders options in fixed A→D order with NO client shuffle, so
 * an unshuffled pack has the answer sitting in slot A for all 15 questions. Players spot
 * that within one pack.
 *
 * Deterministic on purpose: the seed is derived from a stable key + the question index +
 * the question text, so re-publishing the same pack yields the same shuffle. That keeps
 * the upsert-by-name flow idempotent and keeps the pack stable for anyone who already
 * saw it.
 *
 * Extracted from scripts/seed-daily-quiz.mjs so the quiz factory shares one copy — a
 * second implementation of this would silently reshuffle already-published packs.
 */

const LETTERS = ["A", "B", "C", "D"];

function hashSeed(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle one question's options and recompute its answer letter.
 * `key` is the pack-stable seed component (the daily quiz uses its date; a themed pack
 * uses its name). Malformed questions are returned untouched — validation flags them.
 */
export function shuffleOptions(q, i, key) {
  if (!q?.options || !LETTERS.every((k) => q.options[k]) || !LETTERS.includes(q.answer)) {
    return q;
  }
  const rng = mulberry32(hashSeed(`${key}-${i}-${q.question}`));
  const order = [...LETTERS];
  for (let j = order.length - 1; j > 0; j--) {
    const k = Math.floor(rng() * (j + 1));
    [order[j], order[k]] = [order[k], order[j]];
  }
  // order[slot] = the original letter now placed in that slot.
  const options = {};
  LETTERS.forEach((slot, idx) => { options[slot] = q.options[order[idx]]; });
  const answer = LETTERS[order.indexOf(q.answer)];
  return { ...q, options, answer };
}

/** Shuffle every question in a pack. */
export const shufflePack = (questions, key) => questions.map((q, i) => shuffleOptions(q, i, key));

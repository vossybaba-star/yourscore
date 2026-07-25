/**
 * Tiny deterministic RNG for the gate generator — self-contained so the module
 * has no heavy deps and runs under `node --test`. Same spirit as the seeded RNG
 * in the draft engine: same seed → same questions (reproducible pools, testable).
 */

/** Hash a string seed to a 32-bit int (xfnv1a). */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — returns a () => [0,1) generator from a numeric seed. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: seed a generator directly from a string. */
export function seededRng(seed: string): () => number {
  return rngFrom(hashSeed(seed));
}

/** Fisher–Yates shuffle a copy of `arr` using `rand`. */
export function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

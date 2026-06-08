/**
 * 38-0 Live Multiplayer — match engine (pure, deterministic, server-authoritative).
 *
 * Live H2H is a two-half match: a half's goals come from each side's Strength
 * Rating (recomputed by score.ts after swaps), split by winProbability and drawn
 * from a Poisson keyed on a seeded RNG so the server can resolve reproducibly and
 * audit-ably. A level aggregate may go to an OPT-IN penalty shootout.
 *
 * Type-strippable (no enums) so it runs under `node --test`, like score.ts.
 */

// ─── Tunables (one place — adjust after playtesting) ──────────────────────────

export const LIVE_CONFIG = {
  /** Seconds per phase. lobby waits on both-ready (no deadline). */
  timers: {
    reveal: 5,
    pregame_swap: 25,
    half1: 7,
    halftime_swap: 35,
    half2: 7,
    draw_decision: 15,
    penalties: 7,
  },
  /** Swap budgets per player. */
  swaps: { pregame: 1, halftime: 2 },
  /** Total expected goals per half across both teams (≈2.8 per match). */
  xgPerHalf: 1.4,
  /**
   * Logistic divisor for the per-half goal SHARE. Deliberately softer than
   * score.ts's H2H curve (÷8): aggregating two halves shrinks variance, so a
   * gentler share keeps underdog goals — and upsets — alive over a full match.
   */
  shareDivisor: 12,
  /** Penalty conversion: near coin-flip with only a faint Strength lean. */
  pens: { base: 0.72, lean: 0.0015, min: 0.6, max: 0.82, rounds: 5 },
} as const;

/** Stronger side's expected share of a half's goals. Soft logistic (see config). */
export function shareFor(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / LIVE_CONFIG.shareDivisor));
}

// ─── Phases ───────────────────────────────────────────────────────────────────

export type LivePhase =
  | "lobby" | "reveal" | "pregame_swap" | "half1" | "halftime_swap"
  | "half2" | "draw_decision" | "penalties" | "result" | "abandoned";

// ─── Goals ─────────────────────────────────────────────────────────────────────

/** Knuth Poisson sampler driven by an injected RNG (so resolution is seeded). */
export function poisson(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

/**
 * Resolve one half into goals for each side. Total expected goals is split by
 * winProbability(a, b) — the stronger side gets the larger share — then each
 * side's tally is an independent Poisson draw. The stronger side scores more on
 * average, but variance keeps upsets alive.
 */
export function resolveHalfGoals(a: number, b: number, rng: () => number): { a: number; b: number } {
  const shareA = shareFor(a, b);
  const lambdaA = LIVE_CONFIG.xgPerHalf * shareA;
  const lambdaB = LIVE_CONFIG.xgPerHalf * (1 - shareA);
  return { a: poisson(lambdaA, rng), b: poisson(lambdaB, rng) };
}

/** Aggregate the two halves. `level` flags a tie (which may go to penalties). */
export function aggregate(
  h1: { a: number; b: number },
  h2: { a: number; b: number }
): { a: number; b: number; level: boolean } {
  const a = h1.a + h2.a;
  const b = h1.b + h2.b;
  return { a, b, level: a === b };
}

// ─── Penalties (opt-in, near coin-flip) ────────────────────────────────────────

function pConvert(self: number, opp: number): number {
  const { base, lean, min, max } = LIVE_CONFIG.pens;
  const p = base + (self - opp) * lean;
  return Math.max(min, Math.min(max, p));
}

/**
 * Seeded penalty shootout: `rounds` kicks each, then sudden death until decided.
 * Slight Strength lean on conversion, so it feels like a lottery. Always returns
 * a decisive (a !== b) result.
 */
export function resolveShootout(a: number, b: number, rng: () => number): { a: number; b: number } {
  const pA = pConvert(a, b);
  const pB = pConvert(b, a);
  let ga = 0;
  let gb = 0;
  for (let i = 0; i < LIVE_CONFIG.pens.rounds; i++) {
    if (rng() < pA) ga++;
    if (rng() < pB) gb++;
  }
  // Sudden death — one pair of kicks per round until they differ.
  let guard = 0;
  while (ga === gb && guard++ < 100) {
    const sa = rng() < pA ? 1 : 0;
    const sb = rng() < pB ? 1 : 0;
    ga += sa;
    gb += sb;
  }
  if (ga === gb) ga++; // deterministic backstop (guard exhausted — vanishingly rare)
  return { a: ga, b: gb };
}

// ─── Phase transitions (pure — the DB layer enforces idempotency) ──────────────

export interface PhaseInput {
  phase: LivePhase;
  /** Both players have confirmed/readied for this phase. */
  bothReady: boolean;
  /** now >= phase_deadline. */
  expired: boolean;
  /** Aggregate is level (only meaningful at half2 / draw_decision). */
  level: boolean;
  /** Both players opted into penalties (only meaningful at draw_decision). */
  bothWantPens: boolean;
}

/**
 * The next phase given the current state. Pure and deterministic: same input →
 * same output. Idempotency of the *transition* (applying it once) is enforced by
 * the conditional UPDATE in the advance endpoint; this only decides the target.
 *
 * - `lobby` waits for both-ready (no deadline).
 * - Every other phase advances on both-ready OR deadline.
 * - `half2` → `draw_decision` if level, else `result`.
 * - `draw_decision` → `penalties` only if BOTH opted in, else `result` (a draw).
 */
export function nextPhase(s: PhaseInput): LivePhase {
  const advance = s.bothReady || s.expired;
  switch (s.phase) {
    case "lobby":         return s.bothReady ? "reveal" : "lobby";
    case "reveal":        return advance ? "pregame_swap" : "reveal";
    case "pregame_swap":  return advance ? "half1" : "pregame_swap";
    case "half1":         return advance ? "halftime_swap" : "half1";
    case "halftime_swap": return advance ? "half2" : "halftime_swap";
    case "half2":         return advance ? (s.level ? "draw_decision" : "result") : "half2";
    case "draw_decision": return advance ? (s.bothWantPens ? "penalties" : "result") : "draw_decision";
    case "penalties":     return advance ? "result" : "penalties";
    default:              return s.phase; // result / abandoned are terminal
  }
}

/**
 * 38-0 — canonical match-resolution engine (pure, deterministic, server-authoritative).
 *
 * THE single source of every scoreline in Draft XI: guest quick match, authed async,
 * challenge links, the 38-game season AND live two-half H2H all derive their goals
 * from here, so the same two teams play to the same physics everywhere.
 *
 * Football-true: a side's expected goals (λ) come from ITS attack line vs the
 * OPPONENT'S defence line — not from a single overall Strength number. Two elite
 * attacks against weak defences produce a high-scoring game; two great defences grind
 * to a tight one; the league total still averages ~2.7–2.9. Goals are Poisson draws
 * keyed on a seeded RNG so the server resolves reproducibly and audit-ably.
 *
 * A one-shot 90' match draws Poisson(λ); a live half draws Poisson(λ/2) — and since
 * two independent Poisson(λ/2) sum to Poisson(λ), the two-half total has the SAME
 * distribution as the one-shot. One engine, identical statistics.
 *
 * Type-strippable (no enums) so it runs under `node --test`, like score.ts. Imports
 * only from score.ts to stay free of circular deps.
 */

import type { PlacedPlayer } from "./types";
import { lineRatings, clamp, type LineRatings } from "./score";

export type TeamLines = LineRatings;
export type HomeSide = "A" | "B" | "neutral";

export const MATCH_CONFIG = {
  /** Goals an evenly-matched attack scores vs an equal defence (λ at edge 0). */
  base: 1.35,
  /**
   * Goals added per rating point of (attack − opponent defence). Tuned so the
   * 38-0 brand survives: a ~96-rated XI goes unbeaten-and-undrawn (all 38 wins)
   * ~0.5% of seasons, sharply rarer below that. Note this only sharpens MISMATCHES
   * — an even game (edge 0) is unaffected, so the ~2.7 league-average total and the
   * ~24% even-match draw rate are invariant to this value.
   */
  slope: 0.085,
  /** Added to the home side's λ, subtracted from the away side's (0 when neutral). */
  home: 0.2,
  /** λ clamps — keep even a hopeless attack alive, cap freak mismatches. */
  minL: 0.18,
  maxL: 4.2,
  /** How the four line ratings collapse into one attack / one defence number
   *  (weights sum to 1 on each side, so an all-equal XI yields attack = defence). */
  attW: { attack: 0.7, midfield: 0.3 },
  defW: { defence: 0.55, gk: 0.25, midfield: 0.2 },
} as const;

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

/** Mean of the populated lines — the fallback for an empty line so a partial or
 *  lopsided XI never collapses a rating to 0. A complete XI fills all four lines,
 *  so this only ever bites for the drafting preview, never a real match. */
function linesFallback(l: TeamLines): number {
  const vals = [l.attack, l.midfield, l.defence, l.gk].filter((v) => v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

/** Attacking quality: forward line led, with midfield supply. */
export function attackRating(l: TeamLines, fallback: number): number {
  const att = l.attack || fallback;
  const mid = l.midfield || fallback;
  return MATCH_CONFIG.attW.attack * att + MATCH_CONFIG.attW.midfield * mid;
}

/** Defensive quality: back line led, the keeper behind it, midfield screening.
 *  GK weight sits below the line so a great keeper dampens but can't paper over a
 *  leaky back four. */
export function defenceRating(l: TeamLines, fallback: number): number {
  const def = l.defence || fallback;
  const gk = l.gk || fallback;
  const mid = l.midfield || fallback;
  return MATCH_CONFIG.defW.defence * def + MATCH_CONFIG.defW.gk * gk + MATCH_CONFIG.defW.midfield * mid;
}

/**
 * Expected goals [λA, λB] for one 90' from each side's attack vs the other's defence.
 * `opts.home` adds/removes the home term (default neutral: no home advantage — used
 * by 1v1 quick/async/challenge/live; the season passes "A"/"B" for its 19+19 games).
 */
export function matchLambdas(a: TeamLines, b: TeamLines, opts?: { home?: HomeSide }): [number, number] {
  const fa = linesFallback(a);
  const fb = linesFallback(b);
  const attA = attackRating(a, fa);
  const defA = defenceRating(a, fa);
  const attB = attackRating(b, fb);
  const defB = defenceRating(b, fb);

  const home = opts?.home ?? "neutral";
  const homeA = home === "A" ? MATCH_CONFIG.home : home === "B" ? -MATCH_CONFIG.home : 0;
  const homeB = home === "B" ? MATCH_CONFIG.home : home === "A" ? -MATCH_CONFIG.home : 0;

  const lA = clamp(MATCH_CONFIG.base + MATCH_CONFIG.slope * (attA - defB) + homeA, MATCH_CONFIG.minL, MATCH_CONFIG.maxL);
  const lB = clamp(MATCH_CONFIG.base + MATCH_CONFIG.slope * (attB - defA) + homeB, MATCH_CONFIG.minL, MATCH_CONFIG.maxL);
  return [lA, lB];
}

/** Convenience: squads in, λ out (computes line ratings for each side). */
export function squadLambdas(sa: PlacedPlayer[], sb: PlacedPlayer[], opts?: { home?: HomeSide }): [number, number] {
  return matchLambdas(lineRatings(sa), lineRatings(sb), opts);
}

/** A one-shot 90' scoreline: independent Poisson(λ) draws. */
export function resolveMatchGoals(a: TeamLines, b: TeamLines, rng: () => number, opts?: { home?: HomeSide }): { a: number; b: number } {
  const [la, lb] = matchLambdas(a, b, opts);
  return { a: poisson(la, rng), b: poisson(lb, rng) };
}

/** One half: Poisson(λ/2) each side. Two of these aggregate to a full 90' (Poisson(λ)). */
export function resolveHalfGoals(a: TeamLines, b: TeamLines, rng: () => number, opts?: { home?: HomeSide }): { a: number; b: number } {
  const [la, lb] = matchLambdas(a, b, opts);
  return { a: poisson(la / 2, rng), b: poisson(lb / 2, rng) };
}

/** Side A's share of expected goals — drives cosmetic possession/shots/corners. */
export function attackShare(a: TeamLines, b: TeamLines, opts?: { home?: HomeSide }): number {
  const [la, lb] = matchLambdas(a, b, opts);
  return la + lb > 0 ? la / (la + lb) : 0.5;
}

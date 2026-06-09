/**
 * 38-0 canonical match engine tests — the football-true goal model.
 *
 * Doubles as the calibration harness: a side's goals come from its attack line vs
 * the opponent's defence line, the league total averages ~2.7, draws fall out at a
 * realistic rate, and totals VARY with the matchup (high-scoring shoot-outs vs
 * grinds). Pure + seeded, runnable under `node --test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_CONFIG, attackRating, defenceRating, matchLambdas,
  resolveMatchGoals, resolveHalfGoals, attackShare, type TeamLines,
} from "./match";
import { lineRatings, seededRng } from "./score";
import type { PlacedPlayer, Position } from "./types";

const lines = (att: number, mid: number, def: number, gk: number): TeamLines => ({ attack: att, midfield: mid, defence: def, gk });

// A 4-3-3 XI whose four lines sit at the given overalls (GK,4 def,3 mid,3 att).
function lineSquad(prefix: string, l: { att: number; mid: number; def: number; gk: number }): PlacedPlayer[] {
  const spec: [string, Position, number][] = [
    ["gk", "GK", l.gk], ["rb", "RB", l.def], ["rcb", "CB", l.def], ["lcb", "CB", l.def], ["lb", "LB", l.def],
    ["cdm", "CDM", l.mid], ["rcm", "CM", l.mid], ["lcm", "CM", l.mid],
    ["rw", "RW", l.att], ["st", "ST", l.att], ["lw", "LW", l.att],
  ];
  return spec.map(([slot, pos, overall], i) => ({
    slot, slotPos: pos, position: pos, overall,
    player_season_id: `${prefix}-${slot}-${i}`, name: `${prefix} ${slot}`, club: "T", season: "2020/21",
  }));
}

const meanTotal = (n: number, la: TeamLines, lb: TeamLines): number => {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const g = resolveMatchGoals(la, lb, seededRng(`mt-${i}`));
    total += g.a + g.b;
  }
  return total / n;
};

// ─── λ math ──────────────────────────────────────────────────────────────────

test("equal flat XIs are an even λ (attack = defence on each side)", () => {
  const [a, b] = matchLambdas(lines(80, 80, 80, 80), lines(80, 80, 80, 80));
  assert.equal(a, MATCH_CONFIG.base);
  assert.equal(b, MATCH_CONFIG.base);
});

test("home advantage tilts λ symmetrically", () => {
  const [a, b] = matchLambdas(lines(80, 80, 80, 80), lines(80, 80, 80, 80), { home: "A" });
  assert.ok(Math.abs(a - (MATCH_CONFIG.base + MATCH_CONFIG.home)) < 1e-9, `home λ ${a}`);
  assert.ok(Math.abs(b - (MATCH_CONFIG.base - MATCH_CONFIG.home)) < 1e-9, `away λ ${b}`);
});

test("λ is monotonic: ↑attack raises own λ; ↑defence/gk lowers opponent λ", () => {
  const baseLines = lines(80, 80, 80, 80);
  const [a0, b0] = matchLambdas(baseLines, baseLines);
  const [aAtt, bAtt] = matchLambdas(lines(90, 80, 80, 80), baseLines);
  assert.ok(aAtt > a0, "stronger attack ⇒ higher own λ");
  assert.ok(Math.abs(bAtt - b0) < 1e-9, "raising A's attack leaves B's λ unchanged");
  const [, bDef] = matchLambdas(lines(80, 80, 90, 90), baseLines);
  assert.ok(bDef < b0, "stronger defence/gk ⇒ lower opponent λ");
});

test("λ is clamped at both extremes", () => {
  const [hi] = matchLambdas(lines(99, 99, 99, 99), lines(30, 30, 30, 30));
  assert.equal(hi, MATCH_CONFIG.maxL, "a freak mismatch caps at maxL");
  const [, lo] = matchLambdas(lines(99, 99, 99, 99), lines(30, 30, 30, 30));
  assert.equal(lo, MATCH_CONFIG.minL, "a hopeless attack floors at minL");
});

test("an empty line falls back to the team mean (no λ collapse)", () => {
  // attackRating uses the fallback when the attack line is 0.
  assert.equal(attackRating(lines(0, 80, 80, 80), 80), 80);
  assert.equal(defenceRating(lines(80, 80, 80, 80), 80), 80);
  // matchLambdas derives its own fallback, so a 0 attack line is not catastrophic.
  const [a] = matchLambdas(lines(0, 80, 80, 80), lines(80, 80, 80, 80));
  assert.ok(Math.abs(a - MATCH_CONFIG.base) < 1e-9, `fallback keeps λ sane, got ${a}`);
});

// ─── Calibration: average and variance of totals ───────────────────────────────

test("even matchup averages ~2.7 goals", () => {
  const m = meanTotal(60000, lines(80, 80, 80, 80), lines(80, 80, 80, 80));
  assert.ok(Math.abs(m - 2 * MATCH_CONFIG.base) < 0.08, `even total ${m.toFixed(3)} ~ ${2 * MATCH_CONFIG.base}`);
});

test("two elite attacks vs weak defences produce a high-scoring game", () => {
  const a = lineRatings(lineSquad("att", { att: 92, mid: 85, def: 74, gk: 74 }));
  const m = meanTotal(60000, a, a);
  assert.ok(m > 3.6, `shoot-out total ${m.toFixed(2)} should exceed 3.6`);
});

test("two great defences grind to a low-scoring game", () => {
  const d = lineRatings(lineSquad("def", { att: 82, mid: 82, def: 90, gk: 90 }));
  const m = meanTotal(60000, d, d);
  assert.ok(m < 2.8, `grind total ${m.toFixed(2)} should be under 2.8`);
});

test("two halves aggregate to the same distribution as one 90'", () => {
  const la = lines(86, 82, 80, 80), lb = lines(80, 80, 84, 84);
  const N = 60000;
  let full = 0, halves = 0;
  for (let i = 0; i < N; i++) {
    const f = resolveMatchGoals(la, lb, seededRng(`f-${i}`));
    full += f.a + f.b;
    const rng = seededRng(`h-${i}`);
    const h1 = resolveHalfGoals(la, lb, rng), h2 = resolveHalfGoals(la, lb, rng);
    halves += h1.a + h2.a + h1.b + h2.b;
  }
  assert.ok(Math.abs(full / N - halves / N) < 0.06, `90' ${(full / N).toFixed(3)} ≈ two halves ${(halves / N).toFixed(3)}`);
});

// ─── Win / draw / upset feel ───────────────────────────────────────────────────

test("even matches draw at a realistic rate (~22–29%)", () => {
  const N = 40000;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const g = resolveMatchGoals(lines(80, 80, 80, 80), lines(80, 80, 80, 80), seededRng(`d-${i}`));
    if (g.a === g.b) draws++;
  }
  const rate = draws / N;
  assert.ok(rate > 0.22 && rate < 0.29, `even draw rate ${rate.toFixed(3)} in (0.22, 0.29)`);
});

test("a clear favourite usually wins but upsets survive", () => {
  const fav = lineRatings(lineSquad("fav", { att: 88, mid: 85, def: 86, gk: 86 }));
  const dog = lineRatings(lineSquad("dog", { att: 78, mid: 76, def: 76, gk: 76 }));
  const N = 20000;
  let favWins = 0, dogWins = 0, draws = 0;
  for (let i = 0; i < N; i++) {
    const g = resolveMatchGoals(fav, dog, seededRng(`u-${i}`));
    if (g.a > g.b) favWins++;
    else if (g.b > g.a) dogWins++;
    else draws++;
  }
  const decisive = favWins + dogWins;
  const rate = favWins / decisive;
  assert.ok(rate > 0.6 && rate < 0.9, `favourite decisive win rate ${rate.toFixed(2)} in (0.6, 0.9)`);
  assert.ok(dogWins > 0, "upsets still happen");
  assert.ok(draws > 0, "draws still happen");
});

test("attackShare leans to the bigger-λ side and stays in (0,1)", () => {
  const s = attackShare(lines(90, 85, 80, 80), lines(78, 76, 76, 76));
  assert.ok(s > 0.5 && s < 1, `share ${s.toFixed(3)} favours the stronger attack`);
});

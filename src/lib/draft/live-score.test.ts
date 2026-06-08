/**
 * 38-0 Live Multiplayer engine tests. Run via `bash scripts/draft/run-tests.sh`
 * (compiled to CJS) — the engine is pure with extensionless imports.
 *
 * These double as the tuning harness for the live two-half match: goal
 * distributions land in a football-plausible range, the stronger side wins more
 * often without killing upsets, penalties are near coin-flip, and the phase
 * machine routes every branch deterministically.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  poisson, resolveHalfGoals, aggregate, resolveShootout, nextPhase, LIVE_CONFIG,
  type LivePhase, type PhaseInput,
} from "./live-score";
import { seededRng } from "./score";

// Run a resolver many times over independent seeds and collect a sample.
function sample<T>(n: number, fn: (rng: () => number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(fn(seededRng(`seed-${i}`)));
  return out;
}

// ─── Poisson sanity ────────────────────────────────────────────────────────────

test("poisson mean tracks lambda", () => {
  const N = 20000;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += poisson(0.7, seededRng(`p-${i}`));
  const mean = sum / N;
  assert.ok(Math.abs(mean - 0.7) < 0.05, `mean ${mean} should be ~0.7`);
});

// ─── Half goals ──────────────────────────────────────────────────────────────

test("half goals: total averages near the configured xG", () => {
  const N = 20000;
  let total = 0;
  for (let i = 0; i < N; i++) {
    const g = resolveHalfGoals(80, 80, seededRng(`h-${i}`));
    total += g.a + g.b;
  }
  const avg = total / N;
  assert.ok(Math.abs(avg - LIVE_CONFIG.xgPerHalf) < 0.1, `avg half total ${avg} ~ ${LIVE_CONFIG.xgPerHalf}`);
});

test("half goals: stronger side outscores weaker on average", () => {
  const N = 20000;
  let a = 0;
  let b = 0;
  for (let i = 0; i < N; i++) {
    const g = resolveHalfGoals(90, 65, seededRng(`s-${i}`));
    a += g.a;
    b += g.b;
  }
  assert.ok(a > b * 1.8, `strong ${a} should clearly beat weak ${b}`);
});

test("full match: upset rate stays dramatic-but-fair at a moderate edge", () => {
  // A ~6pt edge over a full two-half match should win most of the time but lose
  // often enough to stay dramatic (target ~70-90% favourite win rate).
  const N = 4000;
  let favWins = 0;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const rng = seededRng(`m-${i}`);
    const agg = aggregate(resolveHalfGoals(84, 78, rng), resolveHalfGoals(84, 78, rng));
    if (agg.a > agg.b) favWins++;
    else if (agg.level) draws++;
  }
  const decisive = N - draws;
  const rate = favWins / decisive;
  assert.ok(rate > 0.6 && rate < 0.92, `favourite decisive win rate ${rate.toFixed(2)} in (0.6, 0.92)`);
  assert.ok(draws > 0, "draws should occur");
});

// ─── Aggregate ─────────────────────────────────────────────────────────────────

test("aggregate sums halves and flags a level tie", () => {
  assert.deepEqual(aggregate({ a: 1, b: 0 }, { a: 1, b: 2 }), { a: 2, b: 2, level: true });
  assert.deepEqual(aggregate({ a: 2, b: 0 }, { a: 1, b: 2 }), { a: 3, b: 2, level: false });
});

// ─── Penalties ─────────────────────────────────────────────────────────────────

test("penalties are always decisive", () => {
  for (const r of sample(500, (rng) => resolveShootout(80, 80, rng))) {
    assert.notEqual(r.a, r.b, "shootout must produce a winner");
  }
});

test("penalties are near coin-flip at equal strength", () => {
  const res = sample(4000, (rng) => resolveShootout(80, 80, rng));
  const aWins = res.filter((r) => r.a > r.b).length / res.length;
  assert.ok(Math.abs(aWins - 0.5) < 0.06, `equal-strength shootout ~50/50, got ${aWins.toFixed(2)}`);
});

test("penalties lean slightly to the stronger side", () => {
  const res = sample(4000, (rng) => resolveShootout(95, 55, rng));
  const aWins = res.filter((r) => r.a > r.b).length / res.length;
  assert.ok(aWins > 0.5 && aWins < 0.75, `strong side leans but stays lottery-ish, got ${aWins.toFixed(2)}`);
});

// ─── Phase machine ─────────────────────────────────────────────────────────────

const base: PhaseInput = { phase: "lobby", bothReady: false, expired: false, level: false, bothWantPens: false };

test("lobby only advances when both are ready (no deadline)", () => {
  assert.equal(nextPhase({ ...base, phase: "lobby", expired: true }), "lobby");
  assert.equal(nextPhase({ ...base, phase: "lobby", bothReady: true }), "reveal");
});

test("timed phases advance on both-ready OR deadline", () => {
  for (const [phase, next] of [
    ["reveal", "pregame_swap"], ["pregame_swap", "half1"], ["half1", "halftime_swap"],
    ["halftime_swap", "half2"], ["penalties", "result"],
  ] as [LivePhase, LivePhase][]) {
    assert.equal(nextPhase({ ...base, phase, expired: true }), next, `${phase} on deadline`);
    assert.equal(nextPhase({ ...base, phase, bothReady: true }), next, `${phase} on ready`);
    assert.equal(nextPhase({ ...base, phase }), phase, `${phase} holds otherwise`);
  }
});

test("half2 routes to draw_decision only when level", () => {
  assert.equal(nextPhase({ ...base, phase: "half2", expired: true, level: true }), "draw_decision");
  assert.equal(nextPhase({ ...base, phase: "half2", expired: true, level: false }), "result");
});

test("draw_decision goes to penalties only if BOTH opt in, else a draw result", () => {
  assert.equal(nextPhase({ ...base, phase: "draw_decision", expired: true, bothWantPens: true }), "penalties");
  assert.equal(nextPhase({ ...base, phase: "draw_decision", expired: true, bothWantPens: false }), "result");
  // No game is forced to penalties: a timeout (default = take the draw) ends as a draw.
  assert.equal(nextPhase({ ...base, phase: "draw_decision", expired: true }), "result");
});

test("nextPhase is deterministic (same input → same output)", () => {
  const inp: PhaseInput = { phase: "half2", bothReady: false, expired: true, level: true, bothWantPens: false };
  assert.equal(nextPhase(inp), nextPhase(inp));
});

test("terminal phases never move", () => {
  assert.equal(nextPhase({ ...base, phase: "result", expired: true, bothReady: true }), "result");
  assert.equal(nextPhase({ ...base, phase: "abandoned", expired: true, bothReady: true }), "abandoned");
});

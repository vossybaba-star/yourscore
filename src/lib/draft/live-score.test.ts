/**
 * 38-0 Live Multiplayer engine tests. Run via `bash scripts/draft/run-tests.sh`
 * (compiled to CJS) — the engine is pure with extensionless imports.
 *
 * Covers the two-half match: scorers/assists/ratings are coherent, the phase machine
 * routes every branch deterministically, penalties are near coin-flip, and the
 * one-shot resolveMatch is deterministic and consistent with its scoreline.
 * The goal MODEL itself (λ from attack vs defence, calibration) is tested in
 * match.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  poisson, aggregate, resolveShootout, nextPhase,
  simulateHalf, buildReport, resolveMatch,
  type LivePhase, type PhaseInput,
} from "./live-score";
import { seededRng } from "./score";
import type { PlacedPlayer, Position } from "./types";

// A plausible 4-3-3 XI for sim tests (GK, 4 def, 3 mid, 3 att), varied overalls.
function mkSquad(prefix: string): PlacedPlayer[] {
  const spec: [string, Position, number][] = [
    ["gk", "GK", 84], ["rb", "RB", 80], ["rcb", "CB", 83], ["lcb", "CB", 82], ["lb", "LB", 79],
    ["rcm", "CM", 85], ["cm", "CDM", 81], ["lcm", "CAM", 86], ["rw", "RW", 88], ["st", "ST", 90], ["lw", "LW", 87],
  ];
  return spec.map(([slot, pos, overall], i) => ({
    slot, slotPos: pos, position: pos, overall,
    player_season_id: `${prefix}-${slot}-${i}`, name: `${prefix} ${slot}`, club: "Test FC", season: "2020/21",
  }));
}

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

test("lobby: ready → reveal; no-show past the deadline → abandoned; else holds", () => {
  assert.equal(nextPhase({ ...base, phase: "lobby", bothReady: true }), "reveal");
  // Both present but nobody readied before the lobby deadline → abandon (don't hang).
  assert.equal(nextPhase({ ...base, phase: "lobby", expired: true }), "abandoned");
  // No deadline yet (e.g. friend lobby awaiting a joiner) → just wait.
  assert.equal(nextPhase({ ...base, phase: "lobby" }), "lobby");
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

// ─── Match simulation (scorers, assists, ratings, corners, throw-ins) ──────────

const sqA = mkSquad("A");
const sqB = mkSquad("B");

test("simulateHalf: events match the scoreline and ratings cover every player", () => {
  for (let i = 0; i < 200; i++) {
    const h = simulateHalf(sqA, sqB, 1, `sim-${i}`);
    const eventsA = h.events.filter((e) => e.side === "a").length;
    const eventsB = h.events.filter((e) => e.side === "b").length;
    assert.equal(eventsA, h.goals.a, "side-a goal events == goals.a");
    assert.equal(eventsB, h.goals.b, "side-b goal events == goals.b");
    assert.equal(h.ratingsA.length, sqA.length, "a player rated for every slot");
    assert.equal(h.ratingsB.length, sqB.length);
    assert.ok(h.corners.a >= 0 && h.corners.b >= 0 && h.throwins.a >= 0 && h.throwins.b >= 0, "no negative stats");
    // Richer broadcast stats are coherent.
    assert.equal(h.possession.a + h.possession.b, 100, "possession sums to 100%");
    assert.ok(h.shots.a >= h.goals.a && h.shots.b >= h.goals.b, "shots >= goals");
    assert.ok(h.shotsOnTarget.a <= h.shots.a && h.shotsOnTarget.a >= h.goals.a, "SOT between goals and shots");
    assert.ok(h.fouls.a >= 0 && h.offsides.a >= 0, "fouls/offsides non-negative");
    for (const r of [...h.ratingsA, ...h.ratingsB]) assert.ok(r.rating >= 4.5 && r.rating <= 9.8, `rating ${r.rating} in range`);
    // First-half goals land in the first 45 minutes.
    for (const e of h.events) assert.ok(e.minute >= 1 && e.minute <= 45, `h1 minute ${e.minute}`);
  }
});

test("simulateHalf: an assist is a different player than the scorer", () => {
  for (let i = 0; i < 300; i++) {
    const h = simulateHalf(sqA, sqB, 2, `asst-${i}`);
    for (const e of h.events) {
      if (e.assistId) assert.notEqual(e.assistId, e.scorerId, "no self-assist");
      assert.ok(e.minute >= 46 && e.minute <= 90, `h2 minute ${e.minute}`);
    }
  }
});

test("simulateHalf is deterministic for a seed", () => {
  assert.deepEqual(
    simulateHalf(sqA, sqB, 1, "fixed"),
    simulateHalf(sqA, sqB, 1, "fixed"),
  );
});

test("buildReport: totals add the halves and PotM is the global top rating", () => {
  const sim = {
    h1: simulateHalf(sqA, sqB, 1, "rep-h1"),
    h2: simulateHalf(sqA, sqB, 2, "rep-h2"),
  };
  const rep = buildReport(sim);
  assert.equal(rep.a.goals, sim.h1.goals.a + sim.h2.goals.a);
  assert.equal(rep.b.corners, sim.h1.corners.b + sim.h2.corners.b);
  assert.equal(rep.a.shots, sim.h1.shots.a + sim.h2.shots.a, "shots are summed");
  assert.equal(rep.a.possession + rep.b.possession, 100, "match possession sums to 100%");
  assert.equal(rep.events.length, sim.h1.events.length + sim.h2.events.length);
  // PotM rating is >= every player on both sides.
  const all = [...rep.ratingsA, ...rep.ratingsB];
  assert.ok(rep.potm, "a PotM exists when players played");
  for (const r of all) assert.ok(rep.potm!.rating >= r.rating - 1e-9, "PotM is the max rating");
  assert.ok(rep.bestA!.rating >= rep.worstA!.rating, "best >= worst (A)");
});

test("buildReport: a half-time sub is rated for the half they played", () => {
  const subbed = mkSquad("A").map((p, i) => (i === 9 ? { ...p, player_season_id: "A-sub-9", name: "A sub" } : p));
  const sim = {
    h1: simulateHalf(sqA, sqB, 1, "sub-h1"),
    h2: simulateHalf(subbed, sqB, 2, "sub-h2"),
  };
  const rep = buildReport(sim);
  const ids = new Set(rep.ratingsA.map((r) => r.id));
  assert.ok(ids.has("A-st-9"), "the player who started H1 is still rated");
  assert.ok(ids.has("A-sub-9"), "the half-time sub is rated too");
});

// ─── One-shot match (quick / async / challenge) ────────────────────────────────

test("resolveMatch is deterministic for a seed", () => {
  assert.deepEqual(resolveMatch(sqA, sqB, "fix"), resolveMatch(sqA, sqB, "fix"));
});

test("resolveMatch: outcome matches the scoreline; allowDraw lets a level game stand", () => {
  let sawDraw = false;
  for (let i = 0; i < 400; i++) {
    const r = resolveMatch(sqA, sqB, `rm-${i}`, { allowDraw: true });
    if (r.outcome === "draw") {
      sawDraw = true;
      assert.equal(r.goals.a, r.goals.b, "a draw is a level scoreline");
      assert.equal(r.pens, null, "no shootout when draws are allowed");
    } else if (r.outcome === "A") assert.ok(r.goals.a > r.goals.b, "A wins ⇒ outscored B");
    else assert.ok(r.goals.b > r.goals.a, "B wins ⇒ outscored A");
    assert.equal(r.report.ratingsA.length, sqA.length, "every A player rated");
    assert.equal(r.report.ratingsB.length, sqB.length, "every B player rated");
  }
  assert.ok(sawDraw, "draws should occur over many even matches");
});

test("resolveMatch: a level 90' is settled by penalties when draws are not allowed", () => {
  for (let i = 0; i < 400; i++) {
    const r = resolveMatch(sqA, sqB, `rmd-${i}`); // allowDraw defaults to false
    assert.notEqual(r.outcome, "draw", "never a draw when not allowed");
    if (r.goals.a === r.goals.b) {
      assert.ok(r.pens && r.pens.a !== r.pens.b, "level 90' settled decisively by pens");
      assert.equal(r.outcome, r.pens!.a > r.pens!.b ? "A" : "B");
    }
  }
});

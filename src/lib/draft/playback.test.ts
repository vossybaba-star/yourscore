/** 38-0 "watch the half" playback-core tests. Run via scripts/draft/run-tests.sh. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { watchFrame, scheduleBeats, WATCH_CONFIG } from "./playback";
import { simulateHalf } from "./live-score";
import type { PlacedPlayer, Position } from "./types";

function squad(prefix: string, base = 84): PlacedPlayer[] {
  const spec: [string, Position, number][] = [
    ["gk", "GK", base], ["rb", "RB", base - 4], ["rcb", "CB", base - 1], ["lcb", "CB", base - 2], ["lb", "LB", base - 5],
    ["cdm", "CDM", base + 1], ["rcm", "CM", base], ["lcm", "CM", base + 2], ["rw", "RW", base + 4], ["st", "ST", base + 6], ["lw", "LW", base + 3],
  ];
  return spec.map(([slot, pos, overall], i) => ({
    slot, slotPos: pos, position: pos, overall,
    player_season_id: `${prefix}-${slot}-${i}`, name: `${prefix} ${slot}`, club: "T", season: "2020/21",
  }));
}

// A strong attack vs a weak defence so most fixtures carry goals + plenty of stats.
const sqA = squad("A", 92);
const sqB = squad("B", 70);

test("scheduleBeats: deterministic, exact length, sorted, in range", () => {
  const s = scheduleBeats("seed-1", 6, 45);
  assert.equal(s.length, 6);
  assert.deepEqual(s, scheduleBeats("seed-1", 6, 45), "same seed → same schedule");
  assert.deepEqual([...s].sort((a, b) => a - b), s, "sorted ascending");
  for (const m of s) assert.ok(m >= 1 && m <= 45, `minute ${m} in [1,45]`);
  assert.deepEqual(scheduleBeats("seed-1", 0, 45), [], "zero count → empty");
});

test("watchFrame: clock runs the half and clamps progress", () => {
  const sim = simulateHalf(sqA, sqB, 1, "clk-1");
  assert.equal(watchFrame(sim, 1, "m", 0).clockMinute, 0);
  assert.equal(watchFrame(sim, 1, "m", 1).clockMinute, 45);
  assert.equal(watchFrame(sim, 1, "m", -3).clockMinute, 0, "negative clamps to 0");
  assert.equal(watchFrame(sim, 1, "m", 5).clockMinute, 45, ">1 clamps to full");
  const sim2 = simulateHalf(sqA, sqB, 2, "clk-2");
  assert.equal(watchFrame(sim2, 2, "m", 0).clockMinute, 45, "second half starts at 45'");
  assert.equal(watchFrame(sim2, 2, "m", 1).clockMinute, 90);
  // No goals shown at the very kick-off of either half.
  assert.equal(watchFrame(sim2, 2, "m", 0).goalsA + watchFrame(sim2, 2, "m", 0).goalsB, 0);
});

test("watchFrame: reveal is monotonic in progress", () => {
  const sim = simulateHalf(sqA, sqB, 1, "mono-1");
  let prevGoals = -1, prevFeed = -1;
  const prevStat = { shots: { a: -1, b: -1 }, corners: { a: -1, b: -1 } };
  for (let i = 0; i <= 20; i++) {
    const f = watchFrame(sim, 1, "m", i / 20);
    const goals = f.goalsA + f.goalsB;
    assert.ok(goals >= prevGoals, "goals never decrease");
    assert.ok(f.feed.length >= prevFeed, "feed never shrinks");
    assert.ok(f.stats.shots.a >= prevStat.shots.a && f.stats.shots.b >= prevStat.shots.b, "shots never decrease");
    assert.ok(f.stats.corners.a >= prevStat.corners.a && f.stats.corners.b >= prevStat.corners.b, "corners never decrease");
    prevGoals = goals; prevFeed = f.feed.length;
    prevStat.shots = f.stats.shots; prevStat.corners = f.stats.corners;
  }
});

test("watchFrame: at progress=1 everything equals the half's real totals", () => {
  for (const half of [1, 2] as const) {
    const sim = simulateHalf(sqA, sqB, half, `final-${half}`);
    const f = watchFrame(sim, half, "m", 1);
    assert.equal(f.goalsA, sim.events.filter((e) => e.side === "a").length, "all side-a goals revealed");
    assert.equal(f.goalsB, sim.events.filter((e) => e.side === "b").length, "all side-b goals revealed");
    assert.deepEqual(f.stats.shots, sim.shots, "shots reach final");
    assert.deepEqual(f.stats.shotsOnTarget, sim.shotsOnTarget, "SOT reaches final");
    assert.deepEqual(f.stats.corners, sim.corners, "corners reach final");
    assert.deepEqual(f.stats.fouls, sim.fouls, "fouls reach final");
    assert.deepEqual(f.stats.offsides, sim.offsides, "offsides reach final");
    assert.deepEqual(f.stats.throwins, sim.throwins, "throw-ins reach final");
    assert.deepEqual(f.stats.possession, sim.possession, "possession reaches final split");
    const goalBeats = f.feed.filter((b) => b.kind === "goal").length;
    assert.equal(goalBeats, sim.events.length, "feed contains every goal");
    assert.ok(f.feed.some((b) => b.kind === (half === 2 ? "fulltime" : "halftime")), "bookend beat present");
  }
});

test("WATCH_CONFIG: a half plays out over 45 real seconds across 45 minutes", () => {
  assert.equal(WATCH_CONFIG.halfSeconds, 45);
  assert.equal(WATCH_CONFIG.matchMinutesPerHalf, 45);
});

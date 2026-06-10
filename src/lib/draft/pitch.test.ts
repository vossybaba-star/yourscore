import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReel, pitchFrame, PITCH_CONFIG } from "./pitch";
import type { HalfSim } from "./live-score";
import type { GoalEvent } from "./live-score";

type Pair = { a: number; b: number };
const P = (a: number, b: number): Pair => ({ a, b });

function mkHalf(over: Partial<HalfSim> = {}): HalfSim {
  return {
    goals: P(0, 0),
    possession: P(50, 50),
    shots: P(4, 4),
    shotsOnTarget: P(2, 2),
    corners: P(3, 3),
    fouls: P(6, 6),
    offsides: P(1, 1),
    throwins: P(8, 8),
    events: [],
    ratingsA: [],
    ratingsB: [],
    ...over,
  };
}

const goal = (side: "a" | "b", minute: number): GoalEvent => ({
  side, minute, scorerId: `s${minute}`, scorerName: `Scorer ${minute}`,
});

const MID = "match-xyz";

test("reel includes every goal", () => {
  const sim = mkHalf({
    goals: P(2, 1),
    events: [goal("a", 12), goal("b", 33), goal("a", 41)],
  });
  const reel = buildReel(sim, 1, MID);
  const goalBeats = reel.beats.filter((b) => b.kind === "goal");
  assert.equal(goalBeats.length, 3);
  for (const m of [12, 33, 41]) assert.ok(goalBeats.some((b) => b.minute === m), `goal at ${m}`);
});

test("maxBeats respected, minBeats guaranteed", () => {
  const busy = mkHalf({ shotsOnTarget: P(9, 9), corners: P(6, 6), events: [goal("a", 5)] });
  assert.ok(buildReel(busy, 1, MID).beats.length <= PITCH_CONFIG.maxBeats);

  const dull = mkHalf({ shots: P(0, 0), shotsOnTarget: P(0, 0), corners: P(0, 0) });
  assert.ok(buildReel(dull, 1, MID).beats.length >= PITCH_CONFIG.minBeats);
});

test("remap is monotonic, starts at 0, ends at 45 (half 1) / 90 (half 2)", () => {
  const sim = mkHalf({ goals: P(1, 1), events: [goal("a", 20), goal("b", 38)] });
  for (const half of [1, 2] as const) {
    const base = half === 2 ? 45 : 0;
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const mm = pitchFrame(sim, half, MID, i / 200).matchMinute;
      assert.ok(mm >= prev - 1e-9, `monotonic @ ${i}`);
      prev = mm;
    }
    assert.ok(pitchFrame(sim, half, MID, 0).matchMinute <= base + 12, "starts at/near kickoff");
    assert.ok(Math.abs(pitchFrame(sim, half, MID, 1).matchMinute - (base + 45)) < 1e-6, "ends at full half");
  }
});

test("segments tile [0,1] contiguously", () => {
  const reel = buildReel(mkHalf({ events: [goal("a", 25)] }), 1, MID);
  assert.equal(reel.segments[0].p0, 0);
  assert.equal(reel.segments[reel.segments.length - 1].p1, 1);
  for (let i = 1; i < reel.segments.length; i++) {
    assert.ok(Math.abs(reel.segments[i].p0 - reel.segments[i - 1].p1) < 1e-9, "no gap/overlap");
  }
});

test("all player and ball coords stay in [0,1]", () => {
  const sim = mkHalf({ goals: P(2, 1), events: [goal("a", 9), goal("b", 22), goal("a", 44)] });
  for (let i = 0; i <= 120; i++) {
    const f = pitchFrame(sim, 1, MID, i / 120);
    assert.ok(f.ball.x >= 0 && f.ball.x <= 1 && f.ball.y >= 0 && f.ball.y <= 1, "ball in bounds");
    assert.equal(f.players.length, 22);
    for (const p of f.players) {
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, "player in bounds");
    }
  }
});

test("possession bias: dominant side's open-play ball sits in the opponent half", () => {
  // A dominates possession and creates more — open play should lean into B's half (x>0.5).
  const sim = mkHalf({
    possession: P(68, 32),
    shotsOnTarget: P(6, 1),
    events: [goal("a", 15), goal("a", 30)],
  });
  let sum = 0, n = 0;
  for (let i = 0; i <= 300; i++) {
    const f = pitchFrame(sim, 1, MID, i / 300);
    if (f.speed === "skip") { sum += f.ball.x; n++; }
  }
  assert.ok(n > 0, "had open-play frames");
  assert.ok(sum / n > 0.5, `mean open-play ball-x ${(sum / n).toFixed(3)} should be in B's half`);
});

test("a goal beat resolves to the scoring side at its goal", () => {
  const sim = mkHalf({ goals: P(1, 0), events: [goal("a", 20)] });
  const reel = buildReel(sim, 1, MID);
  const dwell = reel.segments.find((s) => s.beat?.kind === "goal");
  assert.ok(dwell, "found the goal dwell");
  // progress at/just after the strike instant.
  const mmStrike = 20 + PITCH_CONFIG.dwellAfterMin * 0.5;
  const localT = (mmStrike - dwell!.m0) / (dwell!.m1 - dwell!.m0);
  const progress = dwell!.p0 + localT * (dwell!.p1 - dwell!.p0);
  const f = pitchFrame(sim, 1, MID, progress);
  assert.equal(f.beat?.side, "a");
  assert.ok(f.ball.x > 0.8, `ball at A's attacking goal (x=${f.ball.x.toFixed(2)})`);
});

test("goalsA/B are monotonic and reach the sim totals at progress 1", () => {
  const sim = mkHalf({ goals: P(2, 1), events: [goal("a", 10), goal("b", 28), goal("a", 40)] });
  let pa = 0, pb = 0;
  for (let i = 0; i <= 200; i++) {
    const f = pitchFrame(sim, 1, MID, i / 200);
    assert.ok(f.goalsA >= pa && f.goalsB >= pb, "monotonic");
    pa = f.goalsA; pb = f.goalsB;
  }
  const end = pitchFrame(sim, 1, MID, 1);
  assert.equal(end.goalsA, 2);
  assert.equal(end.goalsB, 1);
});

test("deterministic for a given seed", () => {
  const sim = mkHalf({ goals: P(1, 1), events: [goal("a", 18), goal("b", 35)] });
  for (const p of [0, 0.27, 0.5, 0.83, 1]) {
    assert.deepEqual(pitchFrame(sim, 1, MID, p), pitchFrame(sim, 1, MID, p));
  }
});

import { test } from "node:test";
import assert from "node:assert";
import {
  PENS_CONFIG,
  aiKeeperColumn,
  kickOutcome,
  resolveRound,
  shootoutStatus,
  kickAllowed,
  resolveInteractiveShootout,
  zoneColumn,
} from "./pens";
import type { PenKick, PenZone, PenColumn, ShootoutInputs } from "./pens";
import { seededRng } from "./score";

const K = (outcome: PenKick["outcome"]): PenKick => ({ shot: 1, dive: 0, outcome });
const g = K("goal");
const m = K("missed");

// ─── Determinism ───────────────────────────────────────────────────────────────

test("resolveRound is deterministic and per-round independent", () => {
  const k1 = resolveRound("seed-x", "a", 3, { shot: 5 });
  const k2 = resolveRound("seed-x", "a", 3, { shot: 5 });
  assert.deepStrictEqual(k1, k2);
  // A different round draws from different sub-seeds (overwhelmingly different dive
  // across rounds 1..50 if independence holds).
  const dives = new Set<number>();
  for (let r = 1; r <= 50; r++) dives.add(resolveRound("seed-x", "a", r, { shot: 5 }).dive);
  assert.ok(dives.size > 1);
});

test("resolveInteractiveShootout is deterministic", () => {
  const inputs: ShootoutInputs = { aShots: [0, 4, 5], aDives: [1, 2], bShots: [2] };
  const r1 = resolveInteractiveShootout("seed-d", inputs, "alternating");
  const r2 = resolveInteractiveShootout("seed-d", inputs, "alternating");
  assert.deepStrictEqual(r1, r2);
});

// ─── Per-kick vs full-recompute agreement (the server-integrity invariant) ────

test("explicitly re-feeding an auto-resolved shootout's zones reproduces it exactly", () => {
  for (const mode of ["alternating", "simultaneous"] as const) {
    for (let s = 0; s < 30; s++) {
      const seed = `agree-${mode}-${s}`;
      const auto = resolveInteractiveShootout(seed, {}, mode);
      const replay = resolveInteractiveShootout(
        seed,
        {
          aShots: auto.a.map((k) => k.shot),
          bShots: auto.b.map((k) => k.shot),
          aDives: auto.b.map((k) => k.dive), // a's keeper faced b's kicks
          bDives: auto.a.map((k) => k.dive),
        },
        mode
      );
      assert.deepStrictEqual(replay, auto, `${seed} diverged`);
    }
  }
});

test("kicks resolved one-by-one match the full recompute", () => {
  // Simulate the live path: a partial set of user inputs, kicks resolved as they
  // arrive via resolveRound, then the stored arrays compared against
  // resolveInteractiveShootout over the same raw inputs.
  const seed = "perkick-1";
  const inputs: ShootoutInputs = { aShots: [0, 1, 2, 3, 4], bShots: [5, 4, 3] }; // b stops after 3
  const full = resolveInteractiveShootout(seed, inputs, "simultaneous");
  full.a.forEach((k, i) =>
    assert.deepStrictEqual(resolveRound(seed, "a", i + 1, { shot: inputs.aShots?.[i] }), k)
  );
  full.b.forEach((k, i) =>
    assert.deepStrictEqual(resolveRound(seed, "b", i + 1, { shot: inputs.bShots?.[i] }), k)
  );
});

// ─── Conversion envelope ───────────────────────────────────────────────────────

const N = 3000;

test("every zone converts within [0.68, 0.84] vs the AI keeper; mixed mean in [0.72, 0.80]", () => {
  let mixedGoals = 0;
  for (let z = 0 as PenZone; z <= 5; z++) {
    let goals = 0;
    for (let i = 0; i < N; i++) {
      const rng = seededRng(`env-${z}-${i}`);
      const dive = aiKeeperColumn(rng);
      if (kickOutcome(z as PenZone, dive, rng) === "goal") goals++;
    }
    const rate = goals / N;
    mixedGoals += goals;
    assert.ok(rate >= 0.68 && rate <= 0.84, `zone ${z} converts at ${rate}`);
  }
  const mixed = mixedGoals / (6 * N);
  assert.ok(mixed >= 0.72 && mixed <= 0.8, `mixed mean ${mixed}`);
});

test("corner-high has the highest miss rate; matched dives save within bands", () => {
  const missRate = (z: PenZone): number => {
    let miss = 0;
    for (let i = 0; i < N; i++) {
      // Keeper away from the ball so only the wild-miss roll can fail it.
      const dive = (zoneColumn(z) === 0 ? 2 : 0) as PenColumn;
      if (kickOutcome(z, dive, seededRng(`miss-${z}-${i}`)) === "missed") miss++;
    }
    return miss / N;
  };
  assert.ok(missRate(3) > missRate(0)); // corner high > corner low
  assert.ok(missRate(0) > missRate(1)); // corner low > center low

  const savedRate = (z: PenZone): number => {
    let saved = 0;
    for (let i = 0; i < N; i++) {
      if (kickOutcome(z, zoneColumn(z), seededRng(`save-${z}-${i}`)) === "saved") saved++;
    }
    return saved / N;
  };
  const sLow = savedRate(1); // center low, matched: ≈ (1-0.01)*0.90 = 0.891
  assert.ok(sLow >= 0.84 && sLow <= 0.94, `center-low matched save ${sLow}`);
  const sHigh = savedRate(3); // corner high, matched: ≈ (1-0.10)*0.30 = 0.27
  assert.ok(sHigh >= 0.21 && sHigh <= 0.33, `corner-high matched save ${sHigh}`);
});

test("auto-fill (CPU shooter vs AI keeper) converts near the legacy 0.72", () => {
  let goals = 0;
  let kicks = 0;
  for (let s = 0; s < 600; s++) {
    const r = resolveInteractiveShootout(`auto-${s}`, {}, "simultaneous");
    goals += r.score.a + r.score.b;
    kicks += r.a.length + r.b.length;
  }
  // Backstop bumps are not kicks; their effect over 600 seeds is negligible.
  const rate = goals / kicks;
  assert.ok(rate >= 0.7 && rate <= 0.84, `auto conversion ${rate}`);
});

// ─── Status: early termination, sudden death, gating ──────────────────────────

test("alternating: early termination once the lead is uncatchable", () => {
  // a 3/3, b 0/2 → b could still reach 3 with three kicks left: not decided.
  let st = shootoutStatus([g, g, g], [m, m], "alternating");
  assert.strictEqual(st.decided, false);
  assert.strictEqual(st.next, "b");
  assert.strictEqual(st.round, 3);
  // b misses the 3rd: 3 vs 0 with only 2 left → decided, a wins.
  st = shootoutStatus([g, g, g], [m, m, m], "alternating");
  assert.strictEqual(st.decided, true);
  assert.strictEqual(st.winner, "a");
});

test("alternating: level after 5 each goes to sudden death, decided when a pair differs", () => {
  const five = [g, g, g, m, m];
  let st = shootoutStatus(five, five, "alternating");
  assert.deepStrictEqual([st.decided, st.suddenDeath, st.next, st.round], [false, true, "a", 6]);
  // a scores round 6, b due — not decided mid-pair.
  st = shootoutStatus([...five, g], five, "alternating");
  assert.strictEqual(st.decided, false);
  assert.strictEqual(st.next, "b");
  // b misses → decided.
  st = shootoutStatus([...five, g], [...five, m], "alternating");
  assert.deepStrictEqual([st.decided, st.winner], [true, "a"]);
});

test("simultaneous: no early termination in regulation; both shoot all 5", () => {
  // 3-0 after three rounds each would end an alternating shootout — not this one.
  const st = shootoutStatus([g, g, g], [m, m, m], "simultaneous");
  assert.strictEqual(st.decided, false);
  assert.ok(kickAllowed([g, g, g], [m, m, m], "a", "simultaneous"));
  assert.ok(kickAllowed([g, g, g], [m, m, m], "b", "simultaneous"));
  // Regulation is ungated: a may race to 5 while b has taken 1.
  assert.ok(kickAllowed([g, g, g, g], [m], "a", "simultaneous"));
  // ...but a must then wait at 5 for b to finish.
  assert.ok(!kickAllowed([g, g, g, g, g], [m], "a", "simultaneous"));
  assert.ok(kickAllowed([g, g, g, g, g], [m], "b", "simultaneous"));
});

test("simultaneous: sudden-death rounds open only level-and-complete; decided ends it", () => {
  const five = [g, g, m, m, m];
  // Level 2-2 after 5 each → round 6 open to both.
  assert.ok(kickAllowed(five, five, "a", "simultaneous"));
  assert.ok(kickAllowed(five, five, "b", "simultaneous"));
  // a took round 6 → a waits, b finishes the round.
  assert.ok(!kickAllowed([...five, g], five, "a", "simultaneous"));
  assert.ok(kickAllowed([...five, g], five, "b", "simultaneous"));
  // Pair complete and apart → decided, nobody kicks.
  const st = shootoutStatus([...five, g], [...five, m], "simultaneous");
  assert.deepStrictEqual([st.decided, st.winner], [true, "a"]);
  assert.ok(!kickAllowed([...five, g], [...five, m], "a", "simultaneous"));
  assert.ok(!kickAllowed([...five, g], [...five, m], "b", "simultaneous"));
});

// ─── Full resolution ───────────────────────────────────────────────────────────

test("resolveInteractiveShootout is always decisive with bounded kicks", () => {
  for (const mode of ["alternating", "simultaneous"] as const) {
    for (let s = 0; s < 200; s++) {
      const r = resolveInteractiveShootout(`dec-${mode}-${s}`, {}, mode);
      assert.notStrictEqual(r.score.a, r.score.b);
      assert.strictEqual(r.winner, r.score.a > r.score.b ? "a" : "b");
      const cap = PENS_CONFIG.rounds + PENS_CONFIG.maxSuddenDeathRounds;
      assert.ok(r.a.length <= cap && r.b.length <= cap);
      // Either the kicks decided it, or the seeded backstop fired at the cap.
      assert.ok(shootoutStatus(r.a, r.b, mode).decided || r.a.length + r.b.length === 2 * cap);
    }
  }
});

test("alternating auto-resolution never kicks past the decision", () => {
  for (let s = 0; s < 100; s++) {
    const r = resolveInteractiveShootout(`stop-${s}`, {}, "alternating");
    // Removing the last kick must leave the shootout undecided.
    const lastSide = r.a.length === r.b.length ? "b" : "a";
    const a = lastSide === "a" ? r.a.slice(0, -1) : r.a;
    const b = lastSide === "b" ? r.b.slice(0, -1) : r.b;
    assert.strictEqual(shootoutStatus(a, b, "alternating").decided, false, `seed stop-${s} overran`);
  }
});

import { test } from "node:test";
import assert from "node:assert";
import {
  PENS_CONFIG,
  aiKeeperColumn,
  aiPower,
  kickOutcome,
  resolveRound,
  shootoutStatus,
  kickAllowed,
  resolveInteractiveShootout,
  zoneColumn,
  zoneRow,
} from "./pens";
import type { PenKick, PenZone, PenPower, ShootoutInputs } from "./pens";
import { seededRng } from "./score";

const K = (outcome: PenKick["outcome"]): PenKick => ({ shot: 1, power: "good", dive: 0, outcome });
const g = K("goal");
const m = K("missed");

// ─── Determinism ───────────────────────────────────────────────────────────────

test("resolveRound is deterministic and per-round independent", () => {
  const k1 = resolveRound("seed-x", "a", 3, { shot: 8, power: "perfect" });
  const k2 = resolveRound("seed-x", "a", 3, { shot: 8, power: "perfect" });
  assert.deepStrictEqual(k1, k2);
  const dives = new Set<number>();
  for (let r = 1; r <= 50; r++) dives.add(resolveRound("seed-x", "a", r, { shot: 8 }).dive);
  assert.ok(dives.size > 1);
});

test("resolveInteractiveShootout is deterministic", () => {
  const inputs: ShootoutInputs = { aShots: [0, 4, 8], aPowers: ["perfect", "good", "over"], aDives: [1, 2], bShots: [2] };
  const r1 = resolveInteractiveShootout("seed-d", inputs, "alternating");
  const r2 = resolveInteractiveShootout("seed-d", inputs, "alternating");
  assert.deepStrictEqual(r1, r2);
});

// ─── Per-kick vs full-recompute agreement (the server-integrity invariant) ────

test("re-feeding an auto-resolved shootout's inputs reproduces it exactly", () => {
  for (const mode of ["alternating", "simultaneous"] as const) {
    for (let s = 0; s < 30; s++) {
      const seed = `agree-${mode}-${s}`;
      const auto = resolveInteractiveShootout(seed, {}, mode);
      const replay = resolveInteractiveShootout(
        seed,
        {
          aShots: auto.a.map((k) => k.shot), aPowers: auto.a.map((k) => k.power),
          bShots: auto.b.map((k) => k.shot), bPowers: auto.b.map((k) => k.power),
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
  const seed = "perkick-1";
  const inputs: ShootoutInputs = {
    aShots: [0, 2, 6, 8, 4], aPowers: ["good", "perfect", "perfect", "over", "under"],
    bShots: [8, 6, 1], bPowers: ["perfect", "good", "under"],
  };
  const full = resolveInteractiveShootout(seed, inputs, "simultaneous");
  full.a.forEach((k, i) =>
    assert.deepStrictEqual(resolveRound(seed, "a", i + 1, { shot: inputs.aShots?.[i], power: inputs.aPowers?.[i] }), k)
  );
  full.b.forEach((k, i) =>
    assert.deepStrictEqual(resolveRound(seed, "b", i + 1, { shot: inputs.bShots?.[i], power: inputs.bPowers?.[i] }), k)
  );
});

// ─── Conversion envelope ───────────────────────────────────────────────────────

const N = 4000;
/** Conversion of (zone, power) vs the seeded AI keeper. */
function convRate(zone: PenZone, power: PenPower, tag: string): number {
  let goals = 0;
  for (let i = 0; i < N; i++) {
    const rng = seededRng(`${tag}-${zone}-${power}-${i}`);
    const dive = aiKeeperColumn(rng);
    if (kickOutcome(zone, power, dive, rng) === "goal") goals++;
  }
  return goals / N;
}

test("a perfectly-struck shot beats a soft one in the same zone", () => {
  for (const z of [0, 2, 6, 8] as PenZone[]) {
    assert.ok(convRate(z, "perfect", "pw") > convRate(z, "under", "pw"), `zone ${z} perfect>under`);
    assert.ok(convRate(z, "perfect", "pw") > convRate(z, "over", "pw"), `zone ${z} perfect>over`);
  }
});

test("every zone converts in a sane band; well-struck corners are strong but not certain", () => {
  for (let z = 0 as PenZone; z <= 8; z++) {
    const r = convRate(z as PenZone, "good", "band");
    assert.ok(r >= 0.55 && r <= 0.9, `zone ${z} good converts ${r.toFixed(3)}`);
  }
  const topCorner = convRate(8, "perfect", "band");
  assert.ok(topCorner >= 0.8 && topCorner <= 0.95, `top corner perfect ${topCorner.toFixed(3)}`);
});

test("higher placement and OVER power raise the wild-miss rate", () => {
  const missRate = (z: PenZone, power: PenPower): number => {
    let miss = 0;
    for (let i = 0; i < N; i++) {
      const dive = (zoneColumn(z) === 0 ? 2 : 0); // keeper away → only the miss roll can fail it
      if (kickOutcome(z, power, dive as 0 | 1 | 2, seededRng(`miss-${z}-${power}-${i}`)) === "missed") miss++;
    }
    return miss / N;
  };
  assert.ok(missRate(8, "good") > missRate(2, "good")); // high corner misses more than low corner
  assert.ok(missRate(1, "over") > missRate(1, "perfect")); // OVER blazes it
});

test("auto-fill (CPU shooter vs AI keeper) converts near the legacy 0.72", () => {
  let goals = 0;
  let kicks = 0;
  for (let s = 0; s < 800; s++) {
    const r = resolveInteractiveShootout(`auto-${s}`, {}, "simultaneous");
    goals += r.score.a + r.score.b;
    kicks += r.a.length + r.b.length;
  }
  const rate = goals / kicks;
  assert.ok(rate >= 0.68 && rate <= 0.82, `auto conversion ${rate.toFixed(3)}`);
});

test("aiPower only ever yields valid bands", () => {
  for (let i = 0; i < 500; i++) {
    assert.ok(["under", "good", "perfect", "over"].includes(aiPower(seededRng(`p-${i}`))));
  }
});

// ─── Status: early termination, sudden death, gating ──────────────────────────

test("alternating: early termination once the lead is uncatchable", () => {
  let st = shootoutStatus([g, g, g], [m, m], "alternating");
  assert.strictEqual(st.decided, false);
  assert.strictEqual(st.next, "b");
  st = shootoutStatus([g, g, g], [m, m, m], "alternating");
  assert.strictEqual(st.decided, true);
  assert.strictEqual(st.winner, "a");
});

test("simultaneous: no early termination in regulation; both shoot all 5", () => {
  const st = shootoutStatus([g, g, g], [m, m, m], "simultaneous");
  assert.strictEqual(st.decided, false);
  assert.ok(kickAllowed([g, g, g, g], [m], "a", "simultaneous"));
  assert.ok(!kickAllowed([g, g, g, g, g], [m], "a", "simultaneous"));
  assert.ok(kickAllowed([g, g, g, g, g], [m], "b", "simultaneous"));
});

test("simultaneous: sudden-death rounds open only level-and-complete; decided ends it", () => {
  const five = [g, g, m, m, m];
  assert.ok(kickAllowed(five, five, "a", "simultaneous"));
  assert.ok(!kickAllowed([...five, g], five, "a", "simultaneous"));
  const st = shootoutStatus([...five, g], [...five, m], "simultaneous");
  assert.deepStrictEqual([st.decided, st.winner], [true, "a"]);
});

test("resolveInteractiveShootout is always decisive with bounded kicks", () => {
  for (const mode of ["alternating", "simultaneous"] as const) {
    for (let s = 0; s < 200; s++) {
      const r = resolveInteractiveShootout(`dec-${mode}-${s}`, {}, mode);
      assert.notStrictEqual(r.score.a, r.score.b);
      assert.strictEqual(r.winner, r.score.a > r.score.b ? "a" : "b");
      const cap = PENS_CONFIG.rounds + PENS_CONFIG.maxSuddenDeathRounds;
      assert.ok(r.a.length <= cap && r.b.length <= cap);
    }
  }
});

test("zone helpers map the 3x3 grid", () => {
  assert.deepStrictEqual([zoneColumn(0), zoneRow(0)], [0, 0]);
  assert.deepStrictEqual([zoneColumn(4), zoneRow(4)], [1, 1]);
  assert.deepStrictEqual([zoneColumn(8), zoneRow(8)], [2, 2]);
});

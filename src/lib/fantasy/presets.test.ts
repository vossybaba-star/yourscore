import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, buildPreset, solvePreset } from "./presets";
import { validateSquad, SQUAD_QUOTA, BUDGET_TENTHS, type PoolPlayer } from "./engine";
import type { FantasyPos } from "./values";

/** A realistic-ish pool: 20 clubs, a price ladder per position so greed has
 *  something to climb. Prices in tenths (£4.0m … £14.5m). */
function makePool(): PoolPlayer[] {
  const pool: PoolPlayer[] = [];
  let id = 1;
  const perPos: Record<FantasyPos, { count: number; lo: number; hi: number }> = {
    GK: { count: 40, lo: 40, hi: 68 },
    DEF: { count: 120, lo: 40, hi: 95 },
    MID: { count: 120, lo: 45, hi: 145 },
    FWD: { count: 80, lo: 45, hi: 145 },
  };
  for (const pos of ["GK", "DEF", "MID", "FWD"] as FantasyPos[]) {
    const { count, lo, hi } = perPos[pos];
    for (let i = 0; i < count; i++) {
      const price = Math.round(lo + ((hi - lo) * i) / (count - 1));
      pool.push({ id: id++, smId: null, name: `${pos}${i}`, club: `C${i % 20}`, clubId: i % 20, pos, priceTenths: price });
    }
  }
  return pool;
}

for (const shape of PRESETS) {
  test(`preset "${shape.id}" builds a legal £100m squad`, () => {
    const pool = makePool();
    const ids = buildPreset(shape, pool); // throws if illegal
    assert.equal(ids.length, 15);
    assert.equal(new Set(ids).size, 15, "no duplicates");
    const squad = validateSquad(ids, pool);
    assert.ok(squad.bankTenths >= 0, "within budget");
    const posCount = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<FantasyPos, number>;
    for (const p of squad.picks) posCount[p.pos]++;
    for (const pos of ["GK", "DEF", "MID", "FWD"] as FantasyPos[])
      assert.equal(posCount[pos], SQUAD_QUOTA[pos], `${pos} quota`);
  });
}

test("greed shapes actually differ in where they invest", () => {
  const pool = makePool();
  const priceOf = new Map(pool.map((p) => [p.id, p.priceTenths]));
  const posOf = new Map(pool.map((p) => [p.id, p.pos]));
  const spendIn = (ids: number[], group: FantasyPos[]) =>
    ids.filter((id) => group.includes(posOf.get(id)!)).reduce((s, id) => s + priceOf.get(id)!, 0);

  const attack = solvePreset(PRESETS.find((p) => p.id === "attack")!, pool);
  const defence = solvePreset(PRESETS.find((p) => p.id === "defence")!, pool);

  // Attack-heavy invests more up front; defence-first invests more at the back.
  assert.ok(spendIn(attack, ["FWD", "MID"]) > spendIn(defence, ["FWD", "MID"]), "attack invests more up front");
  assert.ok(spendIn(defence, ["DEF", "GK"]) > spendIn(attack, ["DEF", "GK"]), "defence invests more at the back");
});

test("anchors are always kept, and the squad stays legal around them", () => {
  const pool = makePool();
  // Pick 3 must-haves across positions: a premium FWD, a mid MID, a cheap DEF.
  const fwds = pool.filter((p) => p.pos === "FWD").sort((a, b) => b.priceTenths - a.priceTenths);
  const mids = pool.filter((p) => p.pos === "MID").sort((a, b) => b.priceTenths - a.priceTenths);
  const defs = pool.filter((p) => p.pos === "DEF").sort((a, b) => a.priceTenths - b.priceTenths);
  const anchors = [fwds[0].id, mids[10].id, defs[0].id];

  for (const shape of PRESETS) {
    const ids = solvePreset(shape, pool, undefined, anchors);
    assert.equal(ids.length, 15, `${shape.id}: full squad`);
    for (const a of anchors) assert.ok(ids.includes(a), `${shape.id}: keeps anchor ${a}`);
    const squad = validateSquad(ids, pool); // legal around the anchors
    assert.ok(squad.bankTenths >= 0);
  }
});

test("the same anchors survive a flip between shapes", () => {
  const pool = makePool();
  const anchors = [
    pool.find((p) => p.pos === "FWD")!.id,
    pool.find((p) => p.pos === "GK")!.id,
  ];
  const a = solvePreset(PRESETS[0], pool, undefined, anchors);
  const b = solvePreset(PRESETS[1], pool, undefined, anchors);
  for (const id of anchors) {
    assert.ok(a.includes(id) && b.includes(id), `anchor ${id} present in both shapes`);
  }
});

test("falls back to a legal squad when the pool is thin/cheap-only", () => {
  // A pool where nobody is expensive — greed can't overspend, must still be legal.
  const pool: PoolPlayer[] = makePool().map((p) => ({ ...p, priceTenths: 45 }));
  const ids = solvePreset(PRESETS[0], pool, BUDGET_TENTHS);
  assert.equal(ids.length, 15);
  const squad = validateSquad(ids, pool);
  assert.ok(squad.bankTenths >= 0);
});

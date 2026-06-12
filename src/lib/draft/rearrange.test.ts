/**
 * Draft XI position-switching tests. Run: `node --test src/lib/draft/rearrange.test.ts`
 * (Node 24 strips the TS types natively; run-tests.sh compiles to CJS).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { movableSlots, rearrange } from "./rearrange";
import { slotsFor } from "./formations";
import type { Formation, PlacedPlayer, Position } from "./types";

// A full XI where each player plays their slot exactly, unless `pos` overrides one.
function buildSquad(formation: Formation, pos: Record<string, Position> = {}): PlacedPlayer[] {
  return slotsFor(formation).map((s, i) => ({
    slot: s.id,
    slotPos: s.pos,
    player_season_id: `p-${s.id}`,
    name: `Player ${s.id}`,
    club: `Club ${i}`,
    season: "2020/21",
    overall: 80,
    position: pos[s.id] ?? s.pos,
  }));
}

const at = (squad: PlacedPlayer[], id: string) => squad.find((p) => p.slot === id);
const ids = (slots: { id: string }[]) => slots.map((s) => s.id).sort();

test("movableSlots: a striker can move only across the front line", () => {
  const squad = buildSquad("4-3-3");
  assert.deepEqual(ids(movableSlots("4-3-3", squad, "st")), ["lw", "rw"]);
});

test("movableSlots: a centre-back can move across the back line only", () => {
  const squad = buildSquad("4-3-3");
  assert.deepEqual(ids(movableSlots("4-3-3", squad, "rcb")), ["lb", "lcb", "rb"]);
  for (const s of movableSlots("4-3-3", squad, "rcb")) {
    assert.ok(["rb", "rcb", "lcb", "lb"].includes(s.id), `${s.id} stayed on the back line`);
  }
});

test("movableSlots: empty / unknown slot yields nothing", () => {
  const squad = buildSquad("4-3-3").filter((p) => p.slot !== "lw"); // lw empty
  assert.deepEqual(movableSlots("4-3-3", squad, "lw"), []);
  assert.deepEqual(movableSlots("4-3-3", buildSquad("4-3-3"), "nope"), []);
});

test("rearrange into a filled slot swaps the two players, both keep their cards", () => {
  const squad = buildSquad("4-3-3");
  const next = rearrange("4-3-3", squad, "st", "rw")!;
  assert.equal(at(next, "rw")!.player_season_id, "p-st");
  assert.equal(at(next, "st")!.player_season_id, "p-rw");
  assert.equal(at(next, "rw")!.slotPos, "RW"); // slotPos follows the new slot
  assert.equal(at(next, "st")!.slotPos, "ST");
  assert.equal(next.length, 11); // no one lost
});

test("rearrange into an empty slot relocates without losing anyone", () => {
  const squad = buildSquad("4-3-3").filter((p) => p.slot !== "lw"); // lw empty (10)
  const next = rearrange("4-3-3", squad, "st", "lw")!;
  assert.equal(next.length, 10);
  assert.equal(at(next, "lw")!.player_season_id, "p-st");
  assert.equal(at(next, "lw")!.slotPos, "LW");
  assert.equal(at(next, "st"), undefined); // st now empty
});

test("rearrange refuses illegal / no-op moves (returns null)", () => {
  const squad = buildSquad("4-3-3");
  assert.equal(rearrange("4-3-3", squad, "st", "cdm"), null); // striker → CM: cross-line
  assert.equal(rearrange("4-3-3", squad, "st", "st"), null);  // onto itself
  assert.equal(rearrange("4-3-3", squad, "nope", "rw"), null); // no player to move
});

test("same-line swap is always legal both ways (category invariant)", () => {
  const squad = buildSquad("4-3-3", { rb: "CB" }); // a CB covering at RB
  const next = rearrange("4-3-3", squad, "rb", "lcb")!;
  assert.equal(at(next, "lcb")!.player_season_id, "p-rb");
  assert.equal(at(next, "rb")!.player_season_id, "p-lcb");
  assert.equal(next.length, 11);
});

test("rearrange preserves every player id (no duplication, no loss)", () => {
  const squad = buildSquad("4-3-3");
  const next = rearrange("4-3-3", squad, "rcm", "lcm")!;
  const before = squad.map((p) => p.player_season_id).sort();
  const after = next.map((p) => p.player_season_id).sort();
  assert.deepEqual(after, before);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pitchName, xiRows, rosterBands, datumFor, isDim, bestWorst,
  type BoardPlayer,
} from "./board";
import type { FantasyPos } from "./engine";

const mk = (id: number, pos: FantasyPos, name: string, price?: number): BoardPlayer => ({
  id, pos, name, label: pitchName(name), price,
});

test("pitchName keeps one word, but two for particled surnames", () => {
  assert.equal(pitchName("Erling Haaland"), "Haaland");
  assert.equal(pitchName("Virgil van Dijk"), "van Dijk");
  assert.equal(pitchName("Kevin De Bruyne"), "De Bruyne");
  assert.equal(pitchName("Saka"), "Saka");
});

test("xiRows groups by position top-down FWD to GK and drops empty bands", () => {
  const posOf = new Map<number, FantasyPos>([
    [1, "GK"], [2, "DEF"], [3, "DEF"], [4, "MID"], [5, "FWD"],
  ]);
  const rows = xiRows([1, 2, 3, 4, 5], posOf);
  assert.deepEqual(rows.map((r) => r.pos), ["FWD", "MID", "DEF", "GK"]);
  assert.deepEqual(rows.find((r) => r.pos === "DEF")!.ids, [2, 3]);
});

test("rosterBands fills to the quota with empty slots", () => {
  const players = [mk(1, "GK", "A"), mk(2, "DEF", "B"), mk(3, "FWD", "C")];
  const bands = rosterBands(players);
  const gk = bands.find((b) => b.pos === "GK")!;
  const def = bands.find((b) => b.pos === "DEF")!;
  const fwd = bands.find((b) => b.pos === "FWD")!;
  assert.equal(gk.filled.length, 1);
  assert.equal(gk.empty, 1); // quota 2
  assert.equal(def.empty, 4); // quota 5
  assert.equal(fwd.empty, 2); // quota 3
});

test("datumFor: price in planning modes, points/minute when live", () => {
  const p = mk(1, "MID", "Palmer", 9.5);
  assert.equal(datumFor("build", p), "£9.5");
  assert.equal(datumFor("transfer", p), "£9.5");
  assert.equal(datumFor("live", p, { points: 6, minute: 67, state: "live" }), "6 · 67'");
  assert.equal(datumFor("live", p, { points: 0, minute: null, state: "tocome" }), "to play");
  assert.equal(datumFor("final", p, { points: 12, state: "done" }), "12 pts");
  assert.equal(datumFor("final", p, { points: 1, state: "done" }), "1 pt");
});

test("isDim: bench dims in planning, non-live dims when live", () => {
  const p = mk(1, "MID", "X");
  assert.equal(isDim("complete", true), true);
  assert.equal(isDim("complete", false), false);
  assert.equal(isDim("live", false, { points: 3, state: "live" }), false);
  assert.equal(isDim("live", false, { points: 0, state: "tocome" }), true);
  assert.equal(isDim("live", false, { points: 2, state: "done" }), true);
  void p;
});

test("bestWorst returns top and bottom scorers, null on empty", () => {
  assert.deepEqual(bestWorst([]), { best: null, worst: null });
  const rows = [{ id: 1, points: 6 }, { id: 2, points: 12 }, { id: 3, points: 2 }];
  const { best, worst } = bestWorst(rows);
  assert.equal(best!.id, 2);
  assert.equal(worst!.id, 3);
});

/**
 * Gate generator tests. Run: `bash scripts/gates/run-tests.sh`.
 *
 * Verifies the two things that matter: the generated questions are CORRECT (the
 * answer really is the higher stat) and CLEAN (no ties / sub-margin / noise), plus
 * that the pipeline is deterministic and the form filter excludes non-starters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Player } from "./types";
import { statValue } from "./types";
import { buildFameIndex, closeness, comparisonDifficulty } from "./fame";
import {
  generateHigherLower,
  generateThisSeasonForm,
  isValidComparison,
  REGULAR_STARTER_MINUTES,
} from "./higher-lower";
import { fplToPlayers, type FplBootstrap } from "./fpl";

function P(over: Partial<Player> & Pick<Player, "id" | "name" | "position">): Player {
  return {
    club: "TST",
    clubId: 1,
    price: 5,
    ownership: 5,
    goals: 0,
    assists: 0,
    appearances: 10,
    minutes: 900,
    points: 50,
    form: 3,
    available: true,
    ...over,
  };
}

const FIXTURE: Player[] = [
  P({ id: 1, name: "Haaland", position: "FWD", price: 14, ownership: 50, goals: 20, minutes: 1800, points: 150, form: 8 }),
  P({ id: 2, name: "Salah", position: "FWD", price: 13, ownership: 45, goals: 18, minutes: 1750, points: 145, form: 7 }),
  P({ id: 3, name: "Palmer", position: "MID", price: 11, ownership: 35, goals: 12, minutes: 1700, points: 130, form: 6.5 }),
  P({ id: 4, name: "Saka", position: "MID", price: 10, ownership: 30, goals: 10, minutes: 1600, points: 120, form: 6 }),
  P({ id: 5, name: "Watkins", position: "FWD", price: 9, ownership: 20, goals: 11, minutes: 1650, points: 110, form: 5.5 }),
  P({ id: 6, name: "Mitoma", position: "MID", price: 6.5, ownership: 8, goals: 6, minutes: 1400, points: 80, form: 4 }),
  P({ id: 7, name: "ObscureDef", position: "DEF", price: 4.5, ownership: 1, goals: 1, minutes: 500, points: 40, form: 2 }),
  // Excluded from This-season form: injured (not available)
  P({ id: 8, name: "InjuredFwd", position: "FWD", price: 7, ownership: 5, goals: 5, minutes: 900, points: 60, form: 0, available: false }),
  // Excluded from This-season form: barely plays
  P({ id: 9, name: "BenchMid", position: "MID", price: 4.5, ownership: 0.5, goals: 0, minutes: 100, points: 15, form: 0.5 }),
];

const byId = new Map(FIXTURE.map((p) => [p.id, p]));

test("fame: famous > obscure, all within 0–100", () => {
  const fame = buildFameIndex(FIXTURE);
  assert.ok(fame.fame(1) > fame.fame(7), "Haaland more famous than ObscureDef");
  assert.ok(fame.fame(1) > fame.fame(9), "Haaland more famous than BenchMid");
  for (const p of FIXTURE) {
    const f = fame.fame(p.id);
    assert.ok(f >= 0 && f <= 100, `${p.name} fame in range: ${f}`);
  }
});

test("closeness + difficulty behave", () => {
  assert.equal(closeness(10, 10), 100);
  assert.equal(closeness(10, 0), 0);
  assert.ok(closeness(20, 18) > closeness(20, 5));
  const d = comparisonDifficulty(10, 10, 90); // obscure + close = hard
  assert.ok(d > comparisonDifficulty(90, 90, 10)); // famous + far = easy
  assert.ok(d >= 0 && d <= 100);
});

test("validator rejects ties, sub-margin and noise; accepts clear", () => {
  assert.equal(isValidComparison(10, 10, 0.15, 2), false, "tie");
  assert.equal(isValidComparison(10, 9, 0.15, 2), false, "sub-margin (10% < 15%)");
  assert.equal(isValidComparison(1, 0, 0.15, 2), false, "below min-top noise");
  assert.equal(isValidComparison(20, 10, 0.15, 2), true, "clear");
  assert.equal(isValidComparison(NaN, 10, 0.15, 2), false, "NaN");
});

test("Higher/Lower: every question's answer is the higher stat", () => {
  for (const stat of ["price", "goals", "points"] as const) {
    const qs = generateHigherLower(FIXTURE, { stat, seed: "s1", count: 20 });
    assert.ok(qs.length > 0, `produced questions for ${stat}`);
    for (const q of qs) {
      assert.equal(q.options.length, 2);
      assert.equal(q.format, "higher-lower");
      const [o1, o2] = q.options;
      const p1 = byId.get(o1.id)!;
      const p2 = byId.get(o2.id)!;
      const higher = statValue(p1, stat) > statValue(p2, stat) ? p1 : p2;
      assert.equal(q.answerId, higher.id, `${stat}: ${p1.name} vs ${p2.name}`);
      assert.ok(q.difficulty >= 0 && q.difficulty <= 100);
      assert.ok(q.answerId === o1.id || q.answerId === o2.id, "answer is one of the options");
    }
  }
});

test("Higher/Lower is deterministic per seed", () => {
  const a = generateHigherLower(FIXTURE, { stat: "goals", seed: "same", count: 15 });
  const b = generateHigherLower(FIXTURE, { stat: "goals", seed: "same", count: 15 });
  assert.deepEqual(a, b);
  const c = generateHigherLower(FIXTURE, { stat: "goals", seed: "different", count: 15 });
  assert.notDeepEqual(a, c);
});

test("This-season form excludes injured + non-starters", () => {
  const qs = generateThisSeasonForm(FIXTURE, { seed: "f1", count: 30, stat: "points" });
  assert.ok(qs.length > 0);
  for (const q of qs) {
    assert.equal(q.format, "this-season-form");
    for (const o of q.options) {
      const p = byId.get(o.id)!;
      assert.ok(p.available, `${p.name} available`);
      assert.ok(p.minutes >= REGULAR_STARTER_MINUTES, `${p.name} is a regular starter`);
      assert.notEqual(o.id, 8, "InjuredFwd excluded");
      assert.notEqual(o.id, 9, "BenchMid excluded");
    }
  }
});

test("FPL adapter maps bootstrap shape correctly", () => {
  const boot: FplBootstrap = {
    teams: [{ id: 1, short_name: "ARS" }],
    elements: [
      {
        id: 100, web_name: "Saka", element_type: 3, team: 1, now_cost: 105,
        selected_by_percent: "30.5", goals_scored: 10, assists: 8, minutes: 1600,
        starts: 18, total_points: 120, form: "6.2", status: "a", code: 223340,
      },
    ],
  };
  const [p] = fplToPlayers(boot);
  assert.equal(p.name, "Saka");
  assert.equal(p.position, "MID");
  assert.equal(p.club, "ARS");
  assert.equal(p.price, 10.5);
  assert.equal(p.ownership, 30.5);
  assert.equal(p.appearances, 18);
  assert.equal(p.available, true);
});

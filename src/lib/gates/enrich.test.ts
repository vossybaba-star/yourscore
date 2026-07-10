/**
 * SportMonks enrichment + Who-am-I tests. Run: `bash scripts/gates/run-tests.sh`.
 * Focus: conservative matching (never wrong, allowed to be missing) and the
 * MCQ clean gate (exactly one option consistent with the clues).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Player } from "./types";
import {
  ageFrom,
  buildEnrichment,
  enrichPlayers,
  lastToken,
  matchClubs,
  normalizeName,
  type SmPlayer,
} from "./sportmonks";
import { buildClues, generateWhoAmI, isAnswerEligible, isExcluded } from "./who-am-i";

const NOW = new Date("2026-07-08T00:00:00Z");

function P(over: Partial<Player> & Pick<Player, "id" | "name" | "position">): Player {
  return {
    club: "MCI", clubId: 1, price: 5, ownership: 5, goals: 0, assists: 0,
    appearances: 10, minutes: 900, points: 50, form: 3, available: true, ...over,
  };
}

test("normalizeName strips accents/case; lastToken picks surname", () => {
  assert.equal(normalizeName("Gündoğan"), "gundogan");
  assert.equal(normalizeName("  Rúben   Dias "), "ruben dias");
  assert.equal(lastToken("M.Salah"), "salah");
  assert.equal(lastToken("Erling Haaland"), "haaland");
});

test("ageFrom computes whole years and rejects nonsense", () => {
  assert.equal(ageFrom("2000-07-21", NOW), 25); // birthday in 13 days
  assert.equal(ageFrom("2000-07-01", NOW), 26);
  assert.equal(ageFrom("bogus", NOW), undefined);
  assert.equal(ageFrom("1950-01-01", NOW), undefined); // out of range
});

test("matchClubs maps unambiguous names only", () => {
  const fpl = [
    { id: 1, name: "Man City" },
    { id: 2, name: "Spurs" },
  ];
  const sm = [
    { id: 9, name: "Manchester City" },
    { id: 6, name: "Tottenham Hotspur" },
    { id: 99, name: "Manchester United" },
  ];
  const map = matchClubs(fpl, sm);
  assert.equal(map.get(1), 9, "Man City → Manchester City (prefix tokens, beats United)");
  assert.equal(map.get(2), 6, "Spurs → Tottenham Hotspur (via alias expansion)");
  // Ambiguity stays unmapped: "City" alone ties Manchester City / Leicester City
  const amb = matchClubs(
    [{ id: 3, name: "City FC" }],
    [
      { id: 9, name: "Manchester City" },
      { id: 31, name: "Leicester City" },
    ],
  );
  assert.equal(amb.has(3), false, "tied score → unmapped, never a wrong club");
});

test("buildEnrichment: unambiguous name+club matches; ambiguity skips", () => {
  const players: Player[] = [
    P({ id: 10, name: "Haaland", position: "FWD", clubId: 1 }),
    P({ id: 11, name: "B.Silva", position: "MID", clubId: 1 }),
    P({ id: 12, name: "D.Silva", position: "MID", clubId: 1 }), // two Silvas at same club → both skipped
    P({ id: 13, name: "Saka", position: "MID", clubId: 2 }), // club unmapped → skipped
  ];
  const sm: SmPlayer[] = [
    { smId: 900, name: "Erling Haaland", clubId: 9, club: "Manchester City", jersey: 9, dateOfBirth: "2000-07-21", nationality: "Norway" },
    { smId: 901, name: "Bernardo Silva", clubId: 9, club: "Manchester City", jersey: 20, dateOfBirth: "1994-08-10", nationality: "Portugal" },
  ];
  const clubMap = new Map([[1, 9]]);
  const enr = buildEnrichment(players, sm, clubMap, NOW);
  assert.deepEqual(enr.get(10), { nationality: "Norway", age: 25, jersey: 9, smId: 900 });
  assert.equal(enr.has(11), false, "two FPL Silvas at the club → ambiguous → skip");
  assert.equal(enr.has(12), false);
  assert.equal(enr.has(13), false, "unmapped club → skip");
  const enriched = enrichPlayers(players, enr);
  assert.equal(enriched[0].nationality, "Norway");
  assert.equal(players[0].nationality, undefined, "input untouched");
});

// --- Who-am-I ---------------------------------------------------------------

const POOL: Player[] = [
  P({ id: 1, name: "Haaland", position: "FWD", ownership: 60, price: 14, goals: 20, nationality: "Norway", age: 25, jersey: 9 }),
  P({ id: 2, name: "Isak", position: "FWD", ownership: 30, price: 9, goals: 12, nationality: "Sweden", age: 26, jersey: 14 }),
  P({ id: 3, name: "Watkins", position: "FWD", ownership: 20, price: 9, goals: 11, nationality: "England", age: 30, jersey: 11 }),
  P({ id: 4, name: "Solanke", position: "FWD", ownership: 10, price: 7.5, goals: 8, nationality: "England", age: 28, jersey: 19 }),
  P({ id: 5, name: "Saka", position: "MID", ownership: 40, price: 10, goals: 10, nationality: "England", age: 24, jersey: 7 }),
  P({ id: 6, name: "Palmer", position: "MID", ownership: 45, price: 11, goals: 12, nationality: "England", age: 24, jersey: 10 }),
  P({ id: 7, name: "Rice", position: "MID", ownership: 15, price: 6.5, goals: 3, nationality: "England", age: 27, jersey: 41 }),
  P({ id: 8, name: "MysteryMid", position: "MID", ownership: 2, price: 4.5, goals: 1 }), // unenriched
  P({ id: 9, name: "Raya", position: "GK", ownership: 12, price: 5.6, goals: 0, nationality: "Spain", age: 30, jersey: 22 }),
];
const byId = new Map(POOL.map((p) => [p.id, p]));

test("who-am-i: answers are fully enriched; unenriched can't be answers", () => {
  assert.equal(isAnswerEligible(byId.get(1)!), true);
  assert.equal(isAnswerEligible(byId.get(8)!), false);
  const qs = generateWhoAmI(POOL, { seed: "w1", count: 20 });
  for (const q of qs) assert.notEqual(q.answerId, 8);
});

test("who-am-i: clean gate — exactly one option consistent with the clues", () => {
  const qs = generateWhoAmI(POOL, { seed: "w2", count: 20 });
  assert.ok(qs.length > 0, "produced questions");
  for (const q of qs) {
    const answer = byId.get(q.answerId)!;
    const clues = buildClues(answer, 3);
    let consistent = 0;
    for (const o of q.options) {
      const p = byId.get(o.id)!;
      if (!isExcluded(p, clues)) consistent++;
    }
    assert.equal(consistent, 1, `${answer.name}: exactly one consistent option`);
    assert.equal(q.options.length, 4);
    // distractors share the answer's position (clue 1 must not solve it)
    for (const o of q.options) assert.equal(byId.get(o.id)!.position, answer.position);
    assert.ok(q.prompt.startsWith("I'm a "), "first-person drip clues");
    assert.ok(q.difficulty >= 0 && q.difficulty <= 100);
  }
});

test("who-am-i: an unexcludable clone blocks the question (precision > coverage)", () => {
  // Clone of Haaland with unknown jersey — position/age/nationality all match,
  // jersey unknown can't exclude, same goals: NOT excludable → any question with
  // Haaland as answer must not use the clone as a distractor.
  const clone = P({ id: 99, name: "HaalandClone", position: "FWD", goals: 20, nationality: "Norway", age: 25 });
  const pool = [...POOL, clone];
  const cloneById = new Map(pool.map((p) => [p.id, p]));
  const qs = generateWhoAmI(pool, { seed: "w3", count: 30 });
  for (const q of qs) {
    const answer = cloneById.get(q.answerId)!;
    const clues = buildClues(answer, 3);
    for (const o of q.options) {
      if (o.id === q.answerId) continue;
      assert.ok(isExcluded(cloneById.get(o.id)!, clues), "every distractor excludable");
    }
  }
});

test("who-am-i is deterministic per seed", () => {
  const a = generateWhoAmI(POOL, { seed: "same", count: 10 });
  const b = generateWhoAmI(POOL, { seed: "same", count: 10 });
  assert.deepEqual(a, b);
});

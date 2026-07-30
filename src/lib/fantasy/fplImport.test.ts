import { test } from "node:test";
import assert from "node:assert/strict";
import { mapFplPicks, parseTeamId, type FplPick } from "./fplImport";

// ── parseTeamId ────────────────────────────────────────────────────────────
test("parseTeamId: bare digits, with whitespace", () => {
  assert.equal(parseTeamId("123456"), 123456);
  assert.equal(parseTeamId("  123456  "), 123456);
  assert.equal(parseTeamId("1"), 1);
});
test("parseTeamId: pulls the id out of pasted FPL URLs", () => {
  assert.equal(parseTeamId("https://fantasy.premierleague.com/entry/1234567/event/1"), 1234567);
  assert.equal(parseTeamId("fantasy.premierleague.com/entry/42"), 42);
  assert.equal(parseTeamId("https://fantasy.premierleague.com/entry/42/history"), 42);
});
test("parseTeamId: garbage, empty, zero, negative, and oversized ids are rejected", () => {
  assert.equal(parseTeamId(""), null);
  assert.equal(parseTeamId("   "), null);
  assert.equal(parseTeamId("not a team id"), null);
  assert.equal(parseTeamId("https://fantasy.premierleague.com/leagues/123"), null);
  assert.equal(parseTeamId("0"), null);
  assert.equal(parseTeamId("-5"), null);
  assert.equal(parseTeamId("100000000"), null); // > 99,999,999
  assert.equal(parseTeamId("99999999"), 99999999); // exactly at the ceiling
});

// ── mapFplPicks ────────────────────────────────────────────────────────────
/** 15 picks: positions 1-11 the XI, 12-15 the bench, element ids 101..115. */
function fullPicks(overrides: Partial<Record<number, Partial<FplPick>>> = {}): FplPick[] {
  const picks: FplPick[] = [];
  for (let position = 1; position <= 15; position++) {
    const element = 100 + position;
    picks.push({
      element, position,
      is_captain: position === 1,
      is_vice_captain: position === 2,
      ...overrides[position],
    });
  }
  return picks;
}
const poolOf = (elements: number[]) => new Set(elements);

test("mapFplPicks: full 15-map produces pickIds in position order and a full selection", () => {
  const picks = fullPicks();
  const pool = poolOf(picks.map((p) => p.element));
  const { pickIds, missingIds, selection } = mapFplPicks(picks, pool);

  assert.deepEqual(pickIds, picks.map((p) => p.element)); // already sorted by position
  assert.deepEqual(missingIds, []);
  assert.ok(selection);
  assert.deepEqual(selection!.xi, picks.slice(0, 11).map((p) => p.element));
  assert.deepEqual(selection!.bench, picks.slice(11, 15).map((p) => p.element));
  assert.equal(selection!.captain, 101);
  assert.equal(selection!.vice, 102);
});

test("mapFplPicks: partial map lists the missing elements and selection is null", () => {
  const picks = fullPicks();
  // pool is missing two elements that aren't in our 522-player pool
  const missingFromPool = [picks[3].element, picks[12].element];
  const pool = poolOf(picks.map((p) => p.element).filter((id) => !missingFromPool.includes(id)));
  const { pickIds, missingIds, selection } = mapFplPicks(picks, pool);

  assert.equal(pickIds.length, 13);
  assert.deepEqual(missingIds.sort((a, b) => a - b), missingFromPool.sort((a, b) => a - b));
  assert.equal(selection, null);
});

test("mapFplPicks: captain missing from the pool still blocks a selection even if all others map", () => {
  const picks = fullPicks();
  const captainId = picks[0].element; // position 1, is_captain
  const pool = poolOf(picks.map((p) => p.element).filter((id) => id !== captainId));
  const { missingIds, selection } = mapFplPicks(picks, pool);

  assert.deepEqual(missingIds, [captainId]);
  assert.equal(selection, null);
});

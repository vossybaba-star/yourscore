/**
 * Unit tests for sync-fixtures.mjs's pure logic — parseGameweek and
 * decideReentries (FIX P2-a) — with no network and no DB.
 *
 *   node --test scripts/gameday/sync-fixtures.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseGameweek, decideReentries } from "./sync-fixtures.mjs";

// ── parseGameweek ────────────────────────────────────────────────────────────

test("parseGameweek: a plain integer string parses cleanly", () => {
  assert.equal(parseGameweek("1"), 1);
  assert.equal(parseGameweek("38"), 38);
});

test("parseGameweek: missing or non-numeric round names yield null, never NaN", () => {
  assert.equal(parseGameweek(null), null);
  assert.equal(parseGameweek(undefined), null);
  assert.equal(parseGameweek(""), null);
  assert.equal(parseGameweek("Round of 16"), null);
});

// ── decideReentries (FIX P2-a) ───────────────────────────────────────────────

test("decideReentries: a cancelled fixture whose kickoff has moved re-enters", () => {
  const rows = [{ fixture_id: 1, kickoff_at: "2026-09-05T14:00:00.000Z" }];
  const existingById = new Map([
    [1, { state: "cancelled", kickoff_at: "2026-08-22T14:00:00.000Z" }],
  ]);
  const out = decideReentries(rows, existingById);
  assert.deepEqual(out, [{ fixture_id: 1, state: "scheduled" }]);
});

test("decideReentries: a cancelled fixture with the SAME kickoff does not re-enter", () => {
  // Same kickoff means SportMonks hasn't actually rescheduled it yet — still
  // legitimately postponed/unconfirmed. Only a genuine date change re-enters.
  const rows = [{ fixture_id: 1, kickoff_at: "2026-08-22T14:00:00.000Z" }];
  const existingById = new Map([
    [1, { state: "cancelled", kickoff_at: "2026-08-22T14:00:00.000Z" }],
  ]);
  assert.deepEqual(decideReentries(rows, existingById), []);
});

test("decideReentries: a non-cancelled fixture is never touched, whatever its kickoff does", () => {
  for (const state of ["scheduled", "base_ready", "approved", "published", "failed"]) {
    const rows = [{ fixture_id: 1, kickoff_at: "2026-09-05T14:00:00.000Z" }];
    const existingById = new Map([[1, { state, kickoff_at: "2026-08-22T14:00:00.000Z" }]]);
    assert.deepEqual(decideReentries(rows, existingById), [], `state=${state} must not re-enter`);
  }
});

test("decideReentries: a brand-new fixture (no existing row) is not a re-entry", () => {
  const rows = [{ fixture_id: 999, kickoff_at: "2026-09-05T14:00:00.000Z" }];
  assert.deepEqual(decideReentries(rows, new Map()), []);
});

test("decideReentries: only the affected fixtures are returned from a mixed batch", () => {
  const rows = [
    { fixture_id: 1, kickoff_at: "2026-09-05T14:00:00.000Z" }, // re-enters
    { fixture_id: 2, kickoff_at: "2026-09-06T14:00:00.000Z" }, // untouched (scheduled)
    { fixture_id: 3, kickoff_at: "2026-09-07T14:00:00.000Z" }, // untouched (new)
  ];
  const existingById = new Map([
    [1, { state: "cancelled", kickoff_at: "2026-08-22T14:00:00.000Z" }],
    [2, { state: "scheduled", kickoff_at: "2026-09-06T14:00:00.000Z" }],
  ]);
  assert.deepEqual(decideReentries(rows, existingById), [{ fixture_id: 1, state: "scheduled" }]);
});

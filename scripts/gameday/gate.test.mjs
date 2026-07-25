/**
 * Unit tests for gate.mjs's pure logic — message composition, tap parsing,
 * the regeneration bound, and the deadline sweep — with no network and no DB.
 *
 *   node --test scripts/gameday/gate.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REGENS,
  gatable,
  slateMessage,
  slateRows,
  reminderMessage,
  parseTap,
  regenAllowed,
  dueForDeadlineCancel,
  allResolved,
  reminderTime,
} from "./gate.mjs";

const fx = (over = {}) => ({
  fixture_id: 19722203,
  home: "Arsenal",
  away: "Coventry City",
  kickoff_at: "2026-08-22T14:00:00Z",
  publish_at: "2026-08-21T08:00:00Z",
  state: "base_ready",
  base_questions: Array.from({ length: 10 }, (_, i) => ({ question: `Q${i}` })),
  ...over,
});

// ── gatable ──────────────────────────────────────────────────────────────────

test("gatable: only base_ready fixtures need a decision", () => {
  const fixtures = [fx(), fx({ fixture_id: 2, state: "approved" }), fx({ fixture_id: 3, state: "cancelled" })];
  assert.deepEqual(gatable(fixtures).map((f) => f.fixture_id), [19722203]);
});

// ── slateMessage / slateRows ─────────────────────────────────────────────────

test("slateMessage: names every pending fixture and states there is no auto-release", () => {
  const text = slateMessage("2026-08-21", [fx()]);
  assert.ok(text.includes("Arsenal"));
  assert.ok(text.includes("Coventry"));
  assert.ok(text.toLowerCase().includes("no auto-release"));
});

test("slateMessage: an empty slate says so instead of an empty list", () => {
  const text = slateMessage("2026-08-21", []);
  assert.ok(text.includes("Nothing left to gate"));
});

test("slateMessage: HTML-escapes club names (Telegram parse_mode=HTML)", () => {
  const text = slateMessage("2026-08-21", [fx({ home: "A & B" })]);
  assert.ok(text.includes("A &amp; B"));
  assert.equal(text.includes("A & B"), false);
});

test("slateRows: one Approve/Regenerate pair per pending fixture, callback data carries the fixture id", () => {
  const rows = slateRows([fx(), fx({ fixture_id: 42, state: "approved" })]);
  assert.equal(rows.length, 1, "the approved fixture must not get a row");
  assert.equal(rows[0].length, 2);
  assert.equal(rows[0][0].data, "approve:19722203");
  assert.equal(rows[0][1].data, "regen:19722203");
});

// ── reminderMessage ──────────────────────────────────────────────────────────

test("reminderMessage: null when everything is already gated", () => {
  assert.equal(reminderMessage("2026-08-21", [fx({ state: "approved" })]), null);
});

test("reminderMessage: lists every still-pending fixture with its publish time", () => {
  const text = reminderMessage("2026-08-21", [fx()]);
  assert.ok(text.includes("Arsenal"));
  assert.ok(text.includes("1 Gameday pack"));
});

// ── parseTap ─────────────────────────────────────────────────────────────────

test("parseTap: recognises approve/regen callback data", () => {
  assert.deepEqual(parseTap("approve:19722203"), { action: "approve", fixtureId: 19722203 });
  assert.deepEqual(parseTap("regen:19722203"), { action: "regen", fixtureId: 19722203 });
});

test("parseTap: a recap sentinel (negative fixture id) still parses", () => {
  assert.deepEqual(parseTap("approve:-28083007"), { action: "approve", fixtureId: -28083007 });
});

test("parseTap: garbage returns null, never throws", () => {
  assert.equal(parseTap("Approve"), null);
  assert.equal(parseTap(""), null);
  assert.equal(parseTap(undefined), null);
  assert.equal(parseTap("approve:notanumber"), null);
});

// ── regenAllowed (bounded ≤2 rounds) ─────────────────────────────────────────

test("regenAllowed: allowed for the first two rounds, refused on the third", () => {
  const counts = {};
  assert.ok(regenAllowed(counts, 1));
  counts[1] = 1;
  assert.ok(regenAllowed(counts, 1));
  counts[1] = MAX_REGENS;
  assert.equal(regenAllowed(counts, 1), false);
});

test("regenAllowed: counts are per-fixture, not global", () => {
  const counts = { 1: MAX_REGENS };
  assert.equal(regenAllowed(counts, 1), false);
  assert.ok(regenAllowed(counts, 2));
});

// ── dueForDeadlineCancel (AC7) ────────────────────────────────────────────────

test("dueForDeadlineCancel: an unapproved fixture past its publish_at is due", () => {
  const now = new Date("2026-08-21T09:00:00Z");
  const due = dueForDeadlineCancel([fx({ publish_at: "2026-08-21T08:00:00Z" })], now);
  assert.equal(due.length, 1);
});

test("dueForDeadlineCancel: not yet due before publish_at", () => {
  const now = new Date("2026-08-21T07:00:00Z");
  const due = dueForDeadlineCancel([fx({ publish_at: "2026-08-21T08:00:00Z" })], now);
  assert.equal(due.length, 0);
});

test("dueForDeadlineCancel: approved/published/cancelled fixtures are never swept, however late", () => {
  const now = new Date("2026-08-22T00:00:00Z");
  for (const state of ["approved", "published", "cancelled"]) {
    const due = dueForDeadlineCancel([fx({ state, publish_at: "2026-08-21T08:00:00Z" })], now);
    assert.equal(due.length, 0, `${state} must never be swept`);
  }
});

// ── allResolved ──────────────────────────────────────────────────────────────

test("allResolved: true only when every fixture is approved/published/cancelled", () => {
  assert.ok(allResolved([fx({ state: "approved" }), fx({ fixture_id: 2, state: "cancelled" })]));
  assert.equal(allResolved([fx({ state: "base_ready" })]), false);
});

// ── reminderTime ─────────────────────────────────────────────────────────────

test("reminderTime: 07:00 Europe/London the day before the matchday (BST)", () => {
  const t = reminderTime("2026-08-22"); // Saturday kickoff day
  // 07:00 BST on 21 Aug = 06:00 UTC.
  assert.equal(t.toISOString(), "2026-08-21T06:00:00.000Z");
});

test("reminderTime: 07:00 Europe/London the day before the matchday (GMT)", () => {
  const t = reminderTime("2026-01-10");
  // 07:00 GMT on 9 Jan = 07:00 UTC.
  assert.equal(t.toISOString(), "2026-01-09T07:00:00.000Z");
});

// Extensionless import matches the repo's other lib tests (src/lib/draft/*.test.ts) and keeps
// `tsc --noEmit` clean. Run under the same bare-tsc harness as challenges-pure.test.ts:
//   npx tsc src/lib/fantasy/feed-pure.ts src/lib/fantasy/feed-pure.test.ts --outDir /tmp/fpt \
//     --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
//     && node --test /tmp/fpt/feed-pure.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formationOf, teamValueOf, parseSquadSnapshot, parsePlayerSnapshot } from "./feed-pure";

// ── formationOf ──────────────────────────────────────────────────────────────

test("formationOf: a standard 4-4-2, GK excluded from the label", () => {
  const xi: ("GK" | "DEF" | "MID" | "FWD")[] = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"];
  assert.equal(formationOf(xi), "4-4-2");
});

test("formationOf: a 3-5-2", () => {
  const xi: ("GK" | "DEF" | "MID" | "FWD")[] = ["GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "FWD", "FWD"];
  assert.equal(formationOf(xi), "3-5-2");
});

test("formationOf: order of the input array doesn't matter", () => {
  const xi: ("GK" | "DEF" | "MID" | "FWD")[] = ["FWD", "FWD", "FWD", "MID", "MID", "MID", "DEF", "DEF", "DEF", "DEF", "GK"];
  assert.equal(formationOf(xi), "4-3-3");
});

// ── teamValueOf ──────────────────────────────────────────────────────────────

test("teamValueOf: sums picks plus the bank, in tenths, then converts once", () => {
  // 15 picks totalling £950.0m in tenths (9500) + a £5.0m bank (50) = £955.0m.
  const picks = Array(15).fill(9500 / 15);
  assert.equal(teamValueOf(picks, 50), 955);
});

test("teamValueOf: zero bank, whole-number tenths", () => {
  assert.equal(teamValueOf([45, 55, 100], 0), 20);
});

test("teamValueOf: an empty pick list is just the bank", () => {
  assert.equal(teamValueOf([], 1000), 100);
});

// ── parseSquadSnapshot ───────────────────────────────────────────────────────

const VALID_SNAPSHOT = {
  players: [
    { id: 1, name: "Erling Haaland", club: "Man City", price: 15.0, pos: "FWD" },
    { id: 2, name: "Alisson", club: "Liverpool", price: 5.5, pos: "GK" },
  ],
};

test("parseSquadSnapshot: a well-formed snapshot round-trips into an id-keyed map", () => {
  const map = parseSquadSnapshot(VALID_SNAPSHOT);
  assert.ok(map);
  assert.equal(map!.size, 2);
  assert.deepEqual(map!.get(1), { id: 1, name: "Erling Haaland", club: "Man City", price: 15.0, pos: "FWD" });
});

test("parseSquadSnapshot: absent payload.snapshot (pre-snapshot posts) is null, not a crash", () => {
  assert.equal(parseSquadSnapshot(undefined), null);
  assert.equal(parseSquadSnapshot(null), null);
  assert.equal(parseSquadSnapshot({}), null);
});

test("parseSquadSnapshot: an empty players array is null", () => {
  assert.equal(parseSquadSnapshot({ players: [] }), null);
});

test("parseSquadSnapshot: one malformed row invalidates the whole snapshot", () => {
  const bad = { players: [VALID_SNAPSHOT.players[0], { id: 2, name: "Alisson", club: "Liverpool", price: 5.5, pos: "GOALKEEPER" }] };
  assert.equal(parseSquadSnapshot(bad), null);
});

test("parseSquadSnapshot: a non-array players field is null", () => {
  assert.equal(parseSquadSnapshot({ players: "not an array" }), null);
});

test("parseSquadSnapshot: a missing name/club/price on a row is null", () => {
  assert.equal(parseSquadSnapshot({ players: [{ id: 1, club: "Arsenal", price: 5, pos: "DEF" }] }), null);
  assert.equal(parseSquadSnapshot({ players: [{ id: 1, name: "", club: "Arsenal", price: 5, pos: "DEF" }] }), null);
});

// ── parsePlayerSnapshot ──────────────────────────────────────────────────────

test("parsePlayerSnapshot: a well-formed snapshot round-trips", () => {
  const snap = parsePlayerSnapshot({ name: "Mohamed Salah", club: "Liverpool", price: 13.0, pos: "MID" });
  assert.deepEqual(snap, { name: "Mohamed Salah", club: "Liverpool", price: 13.0, pos: "MID" });
});

test("parsePlayerSnapshot: absent (pre-snapshot posts) is null", () => {
  assert.equal(parsePlayerSnapshot(undefined), null);
  assert.equal(parsePlayerSnapshot(null), null);
});

test("parsePlayerSnapshot: a bad position is null", () => {
  assert.equal(parsePlayerSnapshot({ name: "X", club: "Y", price: 5, pos: "STRIKER" }), null);
});

test("parsePlayerSnapshot: a non-number price is null", () => {
  assert.equal(parsePlayerSnapshot({ name: "X", club: "Y", price: "5.0", pos: "DEF" }), null);
});

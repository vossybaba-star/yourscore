/**
 * Unit tests for the Club-Fan Leaderboard tally logic.
 *
 * table.ts is deliberately import-free (see its header), so this runs with tsx's
 * native TS/ESM support and Node's built-in test runner — no bundler, no DB, no
 * new dependency. From the worktree root:
 *
 *   npx tsx --test src/lib/clubs/table.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { MIN_PARTICIPANTS, gameweekClubTable, type ClubSupporterRow, type HalftimeAttemptRow } from "./table";

// ── helpers ──────────────────────────────────────────────────────────────────

function supporters(club: string, userIds: string[]): ClubSupporterRow[] {
  return userIds.map((userId) => ({ userId, club }));
}

function attempt(userId: string, score: number): HalftimeAttemptRow {
  return { userId, score };
}

function standingFor(rows: ReturnType<typeof gameweekClubTable>, club: string) {
  const row = rows.find((r) => r.club === club);
  assert.ok(row, `expected a standing for ${club}`);
  return row!;
}

// ── the headline product rule ───────────────────────────────────────────────

test("MIN_PARTICIPANTS is exported and is 5", () => {
  assert.equal(MIN_PARTICIPANTS, 5);
});

test("min-participant threshold: a club with 4 fans is excluded from ranking", () => {
  const sup = supporters("Brentford", ["u1", "u2", "u3", "u4"]);
  const att = ["u1", "u2", "u3", "u4"].map((u) => attempt(u, 8));

  const rows = gameweekClubTable(sup, att, ["Brentford"]);
  const brentford = standingFor(rows, "Brentford");

  assert.equal(brentford.participants, 4);
  assert.equal(brentford.eligible, false);
  assert.equal(brentford.rank, null, "a club under the minimum must not be ranked");
});

test("min-participant threshold: exactly 5 fans clears the bar", () => {
  const sup = supporters("Brentford", ["u1", "u2", "u3", "u4", "u5"]);
  const att = ["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 8));

  const rows = gameweekClubTable(sup, att, ["Brentford"]);
  const brentford = standingFor(rows, "Brentford");

  assert.equal(brentford.participants, 5);
  assert.equal(brentford.eligible, true);
  assert.equal(brentford.rank, 1);
});

test("THE PRODUCT RULE: average beats total — a small sharp club beats a big casual one", () => {
  // 8 sharp Brentford fans, all scoring well (avg 9).
  const brentfordFans = Array.from({ length: 8 }, (_, i) => `bfc${i}`);
  const brentfordSupporters = supporters("Brentford", brentfordFans);
  const brentfordAttempts = brentfordFans.map((u) => attempt(u, 9));

  // 200 casual Man United fans, most scoring low (avg ~3) — but with 200 of them
  // their TOTAL dwarfs Brentford's. A total-based table would put United top.
  const unitedFans = Array.from({ length: 200 }, (_, i) => `mufc${i}`);
  const unitedSupporters = supporters("Manchester United", unitedFans);
  const unitedAttempts = unitedFans.map((u) => attempt(u, 3));

  const rows = gameweekClubTable(
    [...brentfordSupporters, ...unitedSupporters],
    [...brentfordAttempts, ...unitedAttempts],
    ["Brentford", "Manchester United"],
  );

  const brentford = standingFor(rows, "Brentford");
  const united = standingFor(rows, "Manchester United");

  // Sanity: United's raw total is indeed far larger.
  assert.ok(united.totalScore > brentford.totalScore, "United's total must dwarf Brentford's (sanity check)");

  // The actual product rule: Brentford wins on average, and ranks above United.
  assert.ok(brentford.avgScore > united.avgScore);
  assert.equal(brentford.rank, 1, "the sharp small club must rank first");
  assert.equal(united.rank, 2, "the big casual club must rank behind it");
});

test("a fan with multiple halftime attempts in a gameweek contributes ONE entry, not several", () => {
  // u1 played three different fixtures' halftime packs this gameweek: 6, 7, 5.
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5"]);
  const att = [
    attempt("u1", 6),
    attempt("u1", 7),
    attempt("u1", 5),
    attempt("u2", 4),
    attempt("u3", 4),
    attempt("u4", 4),
    attempt("u5", 4),
  ];

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  // Five fans participated — u1 counts once, not three times.
  assert.equal(arsenal.participants, 5);

  // u1's contribution is their TOTAL across all three attempts (6+7+5=18), not
  // three separate 6/7/5 entries diluting the average.
  const expectedTotal = 18 + 4 + 4 + 4 + 4;
  assert.equal(arsenal.totalScore, expectedTotal);
  assert.equal(arsenal.avgScore, expectedTotal / 5);
});

// ── shape + edge cases ───────────────────────────────────────────────────────

test("a club with zero participating fans still appears, unranked, not vanished", () => {
  const rows = gameweekClubTable([], [], ["Brentford"]);
  const brentford = standingFor(rows, "Brentford");

  assert.equal(brentford.participants, 0);
  assert.equal(brentford.totalScore, 0);
  assert.equal(brentford.avgScore, 0);
  assert.equal(brentford.eligible, false);
  assert.equal(brentford.rank, null);
});

test("a supporter with no halftime attempt this gameweek does not count as a participant", () => {
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5", "u6"]);
  // Only 5 of the 6 declared supporters actually played a halftime pack this GW.
  const att = ["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 6));

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  assert.equal(arsenal.participants, 5);
});

test("an attempt from a user with no declared club counts toward no club", () => {
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5"]);
  const att = [
    ...["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 6)),
    attempt("ghost", 10), // never declared a club
  ];

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  assert.equal(arsenal.participants, 5, "the undeclared user must not inflate any club's count");
  assert.equal(arsenal.totalScore, 30);
});

test("ranking: eligible clubs are ordered by avgScore descending, tie-break by totalScore", () => {
  const fansOf = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  const a = fansOf(5, "a");
  const b = fansOf(5, "b");
  const c = fansOf(6, "c");

  const sup = [...supporters("A", a), ...supporters("B", b), ...supporters("C", c)];
  const att = [
    ...a.map((u) => attempt(u, 5)), // avg 5
    ...b.map((u) => attempt(u, 8)), // avg 8 — top
    ...c.map((u) => attempt(u, 5)), // avg 5, same as A, but more total (6 fans vs 5)
  ];

  const rows = gameweekClubTable(sup, att, ["A", "B", "C"]);
  const ranked = rows.filter((r) => r.eligible).sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));

  assert.deepEqual(ranked.map((r) => r.club), ["B", "C", "A"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test("not-enough clubs never get a rank, even when they'd out-average everyone", () => {
  const sup = [...supporters("Tiny", ["t1", "t2"]), ...supporters("Big", ["b1", "b2", "b3", "b4", "b5"])];
  const att = [
    attempt("t1", 10),
    attempt("t2", 10), // Tiny would top the table on average alone (10 vs 4)
    ...["b1", "b2", "b3", "b4", "b5"].map((u) => attempt(u, 4)),
  ];

  const rows = gameweekClubTable(sup, att, ["Tiny", "Big"]);
  const tiny = standingFor(rows, "Tiny");
  const big = standingFor(rows, "Big");

  assert.equal(tiny.eligible, false);
  assert.equal(tiny.rank, null);
  assert.equal(big.eligible, true);
  assert.equal(big.rank, 1, "the only eligible club must be rank 1 regardless of Tiny's higher average");
});

test("clubs outside the roster still tally (defensive), but the roster drives what's reported", () => {
  const rows = gameweekClubTable(supporters("Ghost Town FC", ["g1"]), [attempt("g1", 5)], []);
  // Not part of the passed-in roster, but still surfaced rather than silently dropped.
  const ghost = rows.find((r) => r.club === "Ghost Town FC");
  assert.ok(ghost);
  assert.equal(ghost!.participants, 1);
});

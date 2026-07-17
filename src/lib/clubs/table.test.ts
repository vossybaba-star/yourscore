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

/**
 * An attempt on `club`'s OWN fixture — the only kind that scores (own-club rule).
 * Defaults the opponent to a club nobody in these tests supports, so the fixture
 * only ever counts for `club`.
 */
function attempt(userId: string, score: number, club: string, opponent = "Opponent FC"): HalftimeAttemptRow {
  return { userId, score, home: club, away: opponent };
}

/** An attempt on a fixture the fan's club is NOT in — scores nothing. */
function foreignAttempt(userId: string, score: number): HalftimeAttemptRow {
  return { userId, score, home: "Somewhere FC", away: "Elsewhere United" };
}

function standingFor(rows: ReturnType<typeof gameweekClubTable>, club: string) {
  const row = rows.find((r) => r.club === club);
  assert.ok(row, `expected a standing for ${club}`);
  return row!;
}

// ── the headline product rule ───────────────────────────────────────────────

test("MIN_PARTICIPANTS is 1 — one fan puts a club on the board", () => {
  assert.equal(MIN_PARTICIPANTS, 1);
});

test("no minimum: a club with 4 fans is ranked (the old 5-fan floor is gone)", () => {
  const sup = supporters("Brentford", ["u1", "u2", "u3", "u4"]);
  const att = ["u1", "u2", "u3", "u4"].map((u) => attempt(u, 8, "Brentford"));

  const rows = gameweekClubTable(sup, att, ["Brentford"]);
  const brentford = standingFor(rows, "Brentford");

  assert.equal(brentford.participants, 4);
  assert.equal(brentford.eligible, true);
  assert.equal(brentford.rank, 1);
});

test("no minimum: ONE fan is enough to be ranked", () => {
  const rows = gameweekClubTable(supporters("Brentford", ["u1"]), [attempt("u1", 8, "Brentford")], ["Brentford"]);
  const brentford = standingFor(rows, "Brentford");

  assert.equal(brentford.participants, 1);
  assert.equal(brentford.eligible, true);
  assert.equal(brentford.rank, 1);
});

test("a club with ZERO players is still not ranked — it has no average", () => {
  const rows = gameweekClubTable(supporters("Brentford", ["u1"]), [], ["Brentford"]);
  const brentford = standingFor(rows, "Brentford");

  assert.equal(brentford.participants, 0);
  assert.equal(brentford.eligible, false);
  assert.equal(brentford.rank, null);
});

test("five fans clear the bar (unchanged by the drop)", () => {
  const sup = supporters("Brentford", ["u1", "u2", "u3", "u4", "u5"]);
  const att = ["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 8, "Brentford"));

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
  const brentfordAttempts = brentfordFans.map((u) => attempt(u, 9, "Brentford"));

  // 200 casual Man United fans, most scoring low (avg ~3) — but with 200 of them
  // their TOTAL dwarfs Brentford's. A total-based table would put United top.
  const unitedFans = Array.from({ length: 200 }, (_, i) => `mufc${i}`);
  const unitedSupporters = supporters("Manchester United", unitedFans);
  const unitedAttempts = unitedFans.map((u) => attempt(u, 3, "Manchester United"));

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

test("a fan with multiple OWN-CLUB attempts (double gameweek) contributes ONE entry, not several", () => {
  // Arsenal have two fixtures this gameweek (a double GW), and u1 played both
  // halftime packs: 6 and 7.
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5"]);
  const att = [
    attempt("u1", 6, "Arsenal", "Chelsea"),
    attempt("u1", 7, "Arsenal", "Everton"),
    attempt("u2", 4, "Arsenal"),
    attempt("u3", 4, "Arsenal"),
    attempt("u4", 4, "Arsenal"),
    attempt("u5", 4, "Arsenal"),
  ];

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  // Five fans participated — u1 counts once, not twice.
  assert.equal(arsenal.participants, 5);

  // u1's contribution is their TOTAL across both own-club packs (6+7=13), not
  // two separate entries diluting the average.
  const expectedTotal = 13 + 4 + 4 + 4 + 4;
  assert.equal(arsenal.totalScore, expectedTotal);
  assert.equal(arsenal.avgScore, expectedTotal / 5);
});

// ── the own-club scoring rule (LOCKED, founder 2026-07-16) ───────────────────

test("OWN-CLUB RULE: a pack for a fixture your club isn't in scores nothing", () => {
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5"]);
  const att = [
    ...["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 6, "Arsenal")),
    // u1 also grinds four OTHER fixtures' packs. None of it counts.
    foreignAttempt("u1", 100),
    foreignAttempt("u1", 100),
    foreignAttempt("u1", 100),
    foreignAttempt("u1", 100),
  ];

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  assert.equal(arsenal.totalScore, 30, "farming other clubs' packs must not add a single point");
  assert.equal(arsenal.avgScore, 6);
});

test("OWN-CLUB RULE: a fan who ONLY played other clubs' packs is not a participant", () => {
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5", "u6"]);
  const att = [
    ...["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 6, "Arsenal")),
    foreignAttempt("u6", 99), // played, but never their own club's game
  ];

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  assert.equal(arsenal.participants, 5, "u6 played, but not their club's match — they don't count");
});

test("OWN-CLUB RULE: the AWAY club's fans score from that same fixture", () => {
  // One fixture, Arsenal v Chelsea. Both fanbases score off it.
  const sup = [
    ...supporters("Arsenal", ["a1", "a2", "a3", "a4", "a5"]),
    ...supporters("Chelsea", ["c1", "c2", "c3", "c4", "c5"]),
  ];
  const att = [
    ...["a1", "a2", "a3", "a4", "a5"].map((u) => ({ userId: u, score: 5, home: "Arsenal", away: "Chelsea" })),
    ...["c1", "c2", "c3", "c4", "c5"].map((u) => ({ userId: u, score: 9, home: "Arsenal", away: "Chelsea" })),
  ];

  const rows = gameweekClubTable(sup, att, ["Arsenal", "Chelsea"]);

  assert.equal(standingFor(rows, "Arsenal").participants, 5);
  assert.equal(standingFor(rows, "Chelsea").participants, 5, "away fans count off their own club's fixture");
  assert.equal(standingFor(rows, "Chelsea").rank, 1, "Chelsea's fans knew more");
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
  const att = ["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 6, "Arsenal"));

  const rows = gameweekClubTable(sup, att, ["Arsenal"]);
  const arsenal = standingFor(rows, "Arsenal");

  assert.equal(arsenal.participants, 5);
});

test("an attempt from a user with no declared club counts toward no club", () => {
  const sup = supporters("Arsenal", ["u1", "u2", "u3", "u4", "u5"]);
  const att = [
    ...["u1", "u2", "u3", "u4", "u5"].map((u) => attempt(u, 6, "Arsenal")),
    attempt("ghost", 10, "Arsenal"), // never declared a club
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
    ...a.map((u) => attempt(u, 5, "A")), // avg 5
    ...b.map((u) => attempt(u, 8, "B")), // avg 8 — top
    ...c.map((u) => attempt(u, 5, "C")), // avg 5, same as A, but more total (6 fans vs 5)
  ];

  const rows = gameweekClubTable(sup, att, ["A", "B", "C"]);
  const ranked = rows.filter((r) => r.eligible).sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));

  assert.deepEqual(ranked.map((r) => r.club), ["B", "C", "A"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test("THE CONSEQUENCE OF DROPPING THE FLOOR: two sharp fans now beat five casual ones", () => {
  // The 5-fan minimum existed to stop exactly this. It's gone, deliberately.
  const sup = [...supporters("Tiny", ["t1", "t2"]), ...supporters("Big", ["b1", "b2", "b3", "b4", "b5"])];
  const att = [
    attempt("t1", 10, "Tiny"),
    attempt("t2", 10, "Tiny"),
    ...["b1", "b2", "b3", "b4", "b5"].map((u) => attempt(u, 4, "Big")),
  ];

  const rows = gameweekClubTable(sup, att, ["Tiny", "Big"]);
  const tiny = standingFor(rows, "Tiny");
  const big = standingFor(rows, "Big");

  assert.equal(tiny.eligible, true);
  assert.equal(tiny.rank, 1, "a 2-fan club on a 10 average now tops the table");
  assert.equal(big.rank, 2);
});

test("clubs outside the roster still tally (defensive), but the roster drives what's reported", () => {
  const rows = gameweekClubTable(supporters("Ghost Town FC", ["g1"]), [attempt("g1", 5, "Ghost Town FC")], []);
  // Not part of the passed-in roster, but still surfaced rather than silently dropped.
  const ghost = rows.find((r) => r.club === "Ghost Town FC");
  assert.ok(ghost);
  assert.equal(ghost!.participants, 1);
});

// Extensionless import matches the repo's other lib tests and keeps `tsc
// --noEmit` clean. Run under the same bare-tsc harness as
// challenges-pure.test.ts:
//   npx tsc src/lib/fantasy/competitions-pure.ts src/lib/fantasy/competitions-pure.test.ts --outDir /tmp/cpt2 \
//     --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
//     && node --test /tmp/cpt2/competitions-pure.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCompetitionStatus, isEligibleAttempt, rankLeagueQuiz, resolveBeatTarget, competitionResultLine,
} from "./competitions-pure";

// ── deriveCompetitionStatus ───────────────────────────────────────────────

test("deriveCompetitionStatus: scheduled, before opens_at, stays scheduled", () => {
  const row = { status: "scheduled", opensAt: "2026-08-10T00:00:00Z", closesAt: "2026-08-11T00:00:00Z" };
  assert.equal(deriveCompetitionStatus(row, new Date("2026-08-09T23:59:59Z")), "scheduled");
});

test("deriveCompetitionStatus: scheduled, exactly at opens_at, flips to open", () => {
  const row = { status: "scheduled", opensAt: "2026-08-10T00:00:00Z", closesAt: "2026-08-11T00:00:00Z" };
  assert.equal(deriveCompetitionStatus(row, new Date("2026-08-10T00:00:00Z")), "open");
});

test("deriveCompetitionStatus: open, before closes_at, stays open", () => {
  const row = { status: "open", opensAt: "2026-08-10T00:00:00Z", closesAt: "2026-08-11T00:00:00Z" };
  assert.equal(deriveCompetitionStatus(row, new Date("2026-08-10T12:00:00Z")), "open");
});

test("deriveCompetitionStatus: open, exactly at closes_at, flips to locked", () => {
  const row = { status: "open", opensAt: "2026-08-10T00:00:00Z", closesAt: "2026-08-11T00:00:00Z" };
  assert.equal(deriveCompetitionStatus(row, new Date("2026-08-11T00:00:00Z")), "locked");
});

test("deriveCompetitionStatus: scheduled fast-forwards straight to locked after a long gap, skipping open", () => {
  const row = { status: "scheduled", opensAt: "2026-08-10T00:00:00Z", closesAt: "2026-08-11T00:00:00Z" };
  assert.equal(deriveCompetitionStatus(row, new Date("2026-09-01T00:00:00Z")), "locked");
});

test("deriveCompetitionStatus: terminal/settle-side statuses pass through unchanged regardless of time", () => {
  for (const status of ["locked", "calculating", "completed", "cancelled", "void", "draft", "live"]) {
    const row = { status, opensAt: "2020-01-01T00:00:00Z", closesAt: "2020-01-02T00:00:00Z" };
    assert.equal(deriveCompetitionStatus(row, new Date("2030-01-01T00:00:00Z")), status);
  }
});

// ── isEligibleAttempt ─────────────────────────────────────────────────────

test("isEligibleAttempt: inside the window is eligible", () => {
  assert.equal(isEligibleAttempt({ completedAt: "2026-08-10T12:00:00Z" }, "2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z"), true);
});

test("isEligibleAttempt: exactly at opens_at is eligible (inclusive)", () => {
  assert.equal(isEligibleAttempt({ completedAt: "2026-08-10T00:00:00Z" }, "2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z"), true);
});

test("isEligibleAttempt: exactly at closes_at is NOT eligible (exclusive)", () => {
  assert.equal(isEligibleAttempt({ completedAt: "2026-08-11T00:00:00Z" }, "2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z"), false);
});

test("isEligibleAttempt: an attempt completed BEFORE opens_at is excluded, not errored", () => {
  // The scenario the brief calls out: someone played the pack before the
  // competition window existed. The unique (user_id, pack_id) index means
  // they can never play again, so this is the only path — quietly excluded.
  assert.equal(isEligibleAttempt({ completedAt: "2026-08-09T23:59:59Z" }, "2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z"), false);
});

test("isEligibleAttempt: an attempt completed after closes_at is excluded", () => {
  assert.equal(isEligibleAttempt({ completedAt: "2026-08-11T00:00:01Z" }, "2026-08-10T00:00:00Z", "2026-08-11T00:00:00Z"), false);
});

// ── rankLeagueQuiz ────────────────────────────────────────────────────────

test("rankLeagueQuiz: higher score ranks first", () => {
  const ranked = rankLeagueQuiz([
    { userId: "a", score: 500, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "b", score: 900, completedAt: "2026-08-10T02:00:00Z" },
  ]);
  assert.deepEqual(ranked.map((r) => r.userId), ["b", "a"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test("rankLeagueQuiz: equal score, earlier completion wins the tie", () => {
  const ranked = rankLeagueQuiz([
    { userId: "a", score: 700, completedAt: "2026-08-10T02:00:00Z" },
    { userId: "b", score: 700, completedAt: "2026-08-10T01:00:00Z" },
  ]);
  assert.deepEqual(ranked.map((r) => r.userId), ["b", "a"]);
});

test("rankLeagueQuiz: equal score AND equal completion falls back to userId, deterministically", () => {
  const ranked = rankLeagueQuiz([
    { userId: "zzz", score: 700, completedAt: "2026-08-10T02:00:00Z" },
    { userId: "aaa", score: 700, completedAt: "2026-08-10T02:00:00Z" },
  ]);
  assert.deepEqual(ranked.map((r) => r.userId), ["aaa", "zzz"]);
});

test("rankLeagueQuiz: rank is a plain 1..N ordinal, never shared or skipped", () => {
  const ranked = rankLeagueQuiz([
    { userId: "a", score: 100, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "b", score: 300, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "c", score: 200, completedAt: "2026-08-10T01:00:00Z" },
  ]);
  assert.deepEqual(ranked.map((r) => [r.userId, r.rank]), [["b", 1], ["c", 2], ["a", 3]]);
});

test("rankLeagueQuiz: empty input is an empty list", () => {
  assert.deepEqual(rankLeagueQuiz([]), []);
});

// ── resolveBeatTarget ─────────────────────────────────────────────────────

test("resolveBeatTarget: score exactly at target is placed (inclusive)", () => {
  const [entry] = resolveBeatTarget([{ userId: "a", score: 500, completedAt: "2026-08-10T01:00:00Z" }], 500);
  assert.equal(entry.result, "placed");
});

test("resolveBeatTarget: score under target is played, not placed", () => {
  const [entry] = resolveBeatTarget([{ userId: "a", score: 499, completedAt: "2026-08-10T01:00:00Z" }], 500);
  assert.equal(entry.result, "played");
});

test("resolveBeatTarget: placed entries lead the list ahead of every played entry", () => {
  const resolved = resolveBeatTarget([
    { userId: "low", score: 100, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "high-placed", score: 900, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "mid-played", score: 400, completedAt: "2026-08-10T01:00:00Z" },
  ], 500);
  // Placed group first (just "high-placed" here), then the played group,
  // itself still sorted score desc (400 > 100) — not insertion order.
  assert.deepEqual(resolved.map((r) => r.userId), ["high-placed", "mid-played", "low"]);
  assert.deepEqual(resolved.map((r) => r.result), ["placed", "played", "played"]);
});

test("resolveBeatTarget: everyone who beats the target is a winner — no single-winner cutoff", () => {
  const resolved = resolveBeatTarget([
    { userId: "a", score: 600, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "b", score: 550, completedAt: "2026-08-10T01:00:00Z" },
  ], 500);
  assert.equal(resolved.filter((r) => r.result === "placed").length, 2);
});

test("resolveBeatTarget: within each group, higher score still sorts first", () => {
  const resolved = resolveBeatTarget([
    { userId: "a", score: 600, completedAt: "2026-08-10T01:00:00Z" },
    { userId: "b", score: 900, completedAt: "2026-08-10T01:00:00Z" },
  ], 500);
  assert.deepEqual(resolved.map((r) => r.userId), ["b", "a"]);
});

// ── competitionResultLine ─────────────────────────────────────────────────

test("competitionResultLine: zero entrants reads the same for either format", () => {
  assert.equal(
    competitionResultLine({ format: "league_quiz", entrantCount: 0, winnerName: null, placedCount: 0 }),
    "Nobody entered this one",
  );
  assert.equal(
    competitionResultLine({ format: "beat_target", entrantCount: 0, winnerName: null, placedCount: 0 }),
    "Nobody entered this one",
  );
});

test("competitionResultLine: league_quiz names the winner", () => {
  assert.equal(
    competitionResultLine({ format: "league_quiz", entrantCount: 4, winnerName: "Sam", placedCount: 0 }),
    "Sam won the league quiz",
  );
});

test("competitionResultLine: league_quiz with entrants but somehow no winner name still reads cleanly", () => {
  assert.equal(
    competitionResultLine({ format: "league_quiz", entrantCount: 2, winnerName: null, placedCount: 0 }),
    "The league quiz finished with no result",
  );
});

test("competitionResultLine: beat_target, nobody beat it", () => {
  assert.equal(
    competitionResultLine({ format: "beat_target", entrantCount: 5, winnerName: null, placedCount: 0 }),
    "Nobody beat the target this time. 5 played",
  );
});

test("competitionResultLine: beat_target, exactly one beat it uses singular friend", () => {
  assert.equal(
    competitionResultLine({ format: "beat_target", entrantCount: 5, winnerName: null, placedCount: 1 }),
    "One friend beat the target",
  );
});

test("competitionResultLine: beat_target, several beat it uses plural friends", () => {
  assert.equal(
    competitionResultLine({ format: "beat_target", entrantCount: 5, winnerName: null, placedCount: 3 }),
    "3 friends beat the target",
  );
});

test("competitionResultLine: house style — zero dashes of any kind, ever, in any branch", () => {
  const cases: Parameters<typeof competitionResultLine>[0][] = [
    { format: "league_quiz", entrantCount: 0, winnerName: null, placedCount: 0 },
    { format: "league_quiz", entrantCount: 4, winnerName: "Sam", placedCount: 0 },
    { format: "league_quiz", entrantCount: 2, winnerName: null, placedCount: 0 },
    { format: "beat_target", entrantCount: 5, winnerName: null, placedCount: 0 },
    { format: "beat_target", entrantCount: 5, winnerName: null, placedCount: 1 },
    { format: "beat_target", entrantCount: 5, winnerName: null, placedCount: 3 },
  ];
  for (const c of cases) {
    const line = competitionResultLine(c);
    assert.equal(/[-‐-―]/.test(line), false, `dash found in: "${line}"`);
    assert.equal(/mate\b/i.test(line), false, `"mate" found in: "${line}"`);
  }
});

test("competitionResultLine: never mentions 'mate' even with a winner name containing it as a substring", () => {
  // Defensive — a name is user data, this just documents the copy itself
  // never introduces the word regardless of input.
  const line = competitionResultLine({ format: "league_quiz", entrantCount: 1, winnerName: "Tomate", placedCount: 0 });
  assert.equal(line, "Tomate won the league quiz");
});

// Extensionless import matches the repo's other lib tests (src/lib/draft/*.test.ts) and keeps
// `tsc --noEmit` clean. Run under the same bare-tsc harness as challenges-pure.test.ts:
//   npx tsc src/lib/fantasy/games-pure.ts src/lib/fantasy/games-pure.test.ts --outDir /tmp/gpt \
//     --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
//     && node --test /tmp/gpt/games-pure.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pointsForResult, compareLeaderboardCandidates, sortLeaderboard, deriveStreak, deriveGamesTabAction,
  type LeaderboardCandidate,
} from "./games-pure";

// ── pointsForResult ───────────────────────────────────────────────────────

test("pointsForResult: win 3 / draw 1 / loss 0 — locked", () => {
  assert.equal(pointsForResult("win"), 3);
  assert.equal(pointsForResult("draw"), 1);
  assert.equal(pointsForResult("loss"), 0);
});

// ── compareLeaderboardCandidates / sortLeaderboard ───────────────────────

function cand(over: Partial<LeaderboardCandidate> & { userId: string }): LeaderboardCandidate {
  return { played: 0, wins: 0, draws: 0, losses: 0, points: 0, lastCompletedAt: "2026-01-01T00:00:00.000Z", ...over };
}

test("compareLeaderboardCandidates: points is the primary axis", () => {
  const a = cand({ userId: "a", points: 9 });
  const b = cand({ userId: "b", points: 6 });
  assert.ok(compareLeaderboardCandidates(a, b) < 0);
  assert.ok(compareLeaderboardCandidates(b, a) > 0);
});

test("compareLeaderboardCandidates: equal points falls to wins", () => {
  const a = cand({ userId: "a", points: 6, wins: 2 });
  const b = cand({ userId: "b", points: 6, wins: 1 });
  assert.ok(compareLeaderboardCandidates(a, b) < 0);
});

test("compareLeaderboardCandidates: equal points and wins falls to played", () => {
  const a = cand({ userId: "a", points: 6, wins: 2, played: 5 });
  const b = cand({ userId: "b", points: 6, wins: 2, played: 3 });
  assert.ok(compareLeaderboardCandidates(a, b) < 0);
});

test("compareLeaderboardCandidates: equal on every prior axis falls to EARLIEST last-completion", () => {
  const early = cand({ userId: "early", points: 6, wins: 2, played: 3, lastCompletedAt: "2026-01-01T00:00:00.000Z" });
  const late = cand({ userId: "late", points: 6, wins: 2, played: 3, lastCompletedAt: "2026-02-01T00:00:00.000Z" });
  // The EARLIER completion sorts first — the opposite of "most recently active".
  assert.ok(compareLeaderboardCandidates(early, late) < 0);
  assert.ok(compareLeaderboardCandidates(late, early) > 0);
});

test("sortLeaderboard: full ordering across mixed candidates, cap enforced by the caller not here", () => {
  const rows = [
    cand({ userId: "c", points: 3 }),
    cand({ userId: "a", points: 9 }),
    cand({ userId: "b", points: 6 }),
  ];
  assert.deepEqual(sortLeaderboard(rows).map((r) => r.userId), ["a", "b", "c"]);
});

test("sortLeaderboard: does not mutate the input array", () => {
  const rows = [cand({ userId: "b", points: 3 }), cand({ userId: "a", points: 9 })];
  const copy = [...rows];
  sortLeaderboard(rows);
  assert.deepEqual(rows, copy);
});

// ── deriveStreak ──────────────────────────────────────────────────────────

test("deriveStreak: no completed games is null", () => {
  assert.equal(deriveStreak([]), null);
});

test("deriveStreak: a single completed game is a streak of 1", () => {
  assert.deepEqual(deriveStreak([{ result: "win", completedAt: "2026-01-03T00:00:00.000Z" }]), { type: "win", count: 1 });
});

test("deriveStreak: counts a run of the same result from the newest end", () => {
  const rows = [
    { result: "win" as const, completedAt: "2026-01-05T00:00:00.000Z" },
    { result: "win" as const, completedAt: "2026-01-04T00:00:00.000Z" },
    { result: "win" as const, completedAt: "2026-01-03T00:00:00.000Z" },
    { result: "loss" as const, completedAt: "2026-01-02T00:00:00.000Z" },
    { result: "win" as const, completedAt: "2026-01-01T00:00:00.000Z" },
  ];
  assert.deepEqual(deriveStreak(rows), { type: "win", count: 3 });
});

test("deriveStreak: a draw breaks a win/loss streak just like any other result change", () => {
  const rows = [
    { result: "draw" as const, completedAt: "2026-01-03T00:00:00.000Z" },
    { result: "win" as const, completedAt: "2026-01-02T00:00:00.000Z" },
    { result: "win" as const, completedAt: "2026-01-01T00:00:00.000Z" },
  ];
  assert.deepEqual(deriveStreak(rows), { type: "draw", count: 1 });
});

test("deriveStreak: a streak of draws counts too", () => {
  const rows = [
    { result: "draw" as const, completedAt: "2026-01-02T00:00:00.000Z" },
    { result: "draw" as const, completedAt: "2026-01-01T00:00:00.000Z" },
  ];
  assert.deepEqual(deriveStreak(rows), { type: "draw", count: 2 });
});

// ── deriveGamesTabAction ──────────────────────────────────────────────────

const base = { challengerId: "challenger", opponentId: "opponent", challengerDone: false, opponentDone: false };

test("deriveGamesTabAction: a spectator (neither participant) always gets null, regardless of status", () => {
  for (const status of ["pending", "active", "awaiting_opponent", "completed"]) {
    assert.equal(deriveGamesTabAction({ ...base, status, gameMode: "scorecard" }, "stranger"), null);
    assert.equal(deriveGamesTabAction({ ...base, status, gameMode: "duel" }, "stranger"), null);
  }
});

test("deriveGamesTabAction: pending + viewer is the opponent is decline_or_play, for both game modes", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "pending", gameMode: "scorecard" }, "opponent"), "decline_or_play");
  assert.equal(deriveGamesTabAction({ ...base, status: "pending", gameMode: "duel" }, "opponent"), "decline_or_play");
});

test("deriveGamesTabAction: pending + viewer is the challenger is null — they're the one waiting", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "pending", gameMode: "scorecard" }, "challenger"), null);
  assert.equal(deriveGamesTabAction({ ...base, status: "pending", gameMode: "duel" }, "challenger"), null);
});

test("deriveGamesTabAction: scorecard active + viewer is the opponent is play", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "active", gameMode: "scorecard" }, "opponent"), "play");
});

test("deriveGamesTabAction: scorecard active + viewer is the challenger is null — they already played at creation", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "active", gameMode: "scorecard" }, "challenger"), null);
});

test("deriveGamesTabAction: scorecard has no awaiting_opponent state — always null there", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "awaiting_opponent", gameMode: "scorecard" }, "opponent"), null);
  assert.equal(deriveGamesTabAction({ ...base, status: "awaiting_opponent", gameMode: "scorecard" }, "challenger"), null);
});

test("deriveGamesTabAction: duel active — whichever side has NOT played gets resume", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "active", gameMode: "duel", challengerDone: false }, "challenger"), "resume");
  assert.equal(deriveGamesTabAction({ ...base, status: "active", gameMode: "duel", opponentDone: false }, "opponent"), "resume");
});

test("deriveGamesTabAction: duel active — a side that's already played gets null even though the row is still open", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "active", gameMode: "duel", challengerDone: true }, "challenger"), null);
  assert.equal(deriveGamesTabAction({ ...base, status: "active", gameMode: "duel", opponentDone: true }, "opponent"), null);
});

test("deriveGamesTabAction: duel awaiting_opponent — the side that hasn't played gets resume, the done side gets null", () => {
  const row = { ...base, status: "awaiting_opponent", gameMode: "duel" as const, challengerDone: true, opponentDone: false };
  assert.equal(deriveGamesTabAction(row, "opponent"), "resume");
  assert.equal(deriveGamesTabAction(row, "challenger"), null);
});

test("deriveGamesTabAction: completed is never actionable, for either participant or game mode", () => {
  assert.equal(deriveGamesTabAction({ ...base, status: "completed", gameMode: "scorecard" }, "opponent"), null);
  assert.equal(deriveGamesTabAction({ ...base, status: "completed", gameMode: "duel" }, "challenger"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandForGrade, nextStreak, gradeAnswer, upgradeBand,
  QUIZ_BASE_FLOOR, QUIZ_STREAK_STEP, QUIZ_FLOOR_CAP, QUIZ_WRONG_CEILING,
  UPGRADE_MIN_BUMP, UPGRADE_FLOOR_CAP,
} from "./draft-quiz";

test("a wrong answer removes the floor and caps below elite", () => {
  const b = bandForGrade({ correct: false, streak: 0 });
  assert.equal(b.minOverall, 0);
  assert.equal(b.maxOverall, QUIZ_WRONG_CEILING);
});

test("first correct answer opens an elite ceiling at the base floor", () => {
  const b = bandForGrade({ correct: true, streak: 1 });
  assert.equal(b.minOverall, QUIZ_BASE_FLOOR);
  assert.equal(b.maxOverall, 99);
});

test("a correct streak escalates the floor, capped", () => {
  const two = bandForGrade({ correct: true, streak: 2 });
  assert.equal(two.minOverall, QUIZ_BASE_FLOOR + QUIZ_STREAK_STEP);
  // Far into a streak the floor saturates at the cap, never above.
  const deep = bandForGrade({ correct: true, streak: 50 });
  assert.equal(deep.minOverall, QUIZ_FLOOR_CAP);
});

test("streak counts consecutive correct and resets on a miss", () => {
  assert.equal(nextStreak(0, true), 1);
  assert.equal(nextStreak(3, true), 4);
  assert.equal(nextStreak(4, false), 0);
});

test("gradeAnswer threads streak into the band in one call", () => {
  const first = gradeAnswer(0, true);
  assert.equal(first.streak, 1);
  assert.equal(first.band.minOverall, QUIZ_BASE_FLOOR);

  const miss = gradeAnswer(5, false);
  assert.equal(miss.streak, 0);
  assert.equal(miss.band.maxOverall, QUIZ_WRONG_CEILING);
});

test("upgradeBand: a correct re-spin is a modest improvement on the current player", () => {
  // Floor sits just above the current overall, so candidates are better, not worse.
  const mid = upgradeBand(78);
  assert.equal(mid.minOverall, 78 + UPGRADE_MIN_BUMP);
  assert.equal(mid.maxOverall, 99);
  assert.ok(mid.minOverall > 78);

  // Already-elite slots don't demand elite-only — the floor caps so there's always a pool.
  const elite = upgradeBand(95);
  assert.equal(elite.minOverall, UPGRADE_FLOOR_CAP);
});

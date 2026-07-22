/**
 * Unit tests for the halftime prediction-poll pure logic.
 *
 * predict.ts is import-free (like shared.ts), so this runs with no bundler and
 * no DB. From the worktree root:
 *
 *   npx tsc src/lib/halftime/predict.ts src/lib/halftime/predict.test.ts \
 *     --outDir /tmp/ht-predict-test --module commonjs --target es2022 \
 *     --moduleResolution node --skipLibCheck --strict --esModuleInterop
 *   node --test /tmp/ht-predict-test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  finalGoalsFromScores,
  gradePicks,
  isPick,
  optionLabel,
  pendingLine,
  resultFromGoals,
  settledLine,
  tallyPercent,
  tallyPicks,
  type SmScoreEntry,
} from "./predict";

test("resultFromGoals classifies every outcome", () => {
  assert.equal(resultFromGoals(2, 0), "home");
  assert.equal(resultFromGoals(0, 1), "away");
  assert.equal(resultFromGoals(1, 1), "draw");
  assert.equal(resultFromGoals(0, 0), "draw");
  assert.equal(resultFromGoals(3, 2), "home");
});

test("isPick guards the union", () => {
  assert.equal(isPick("home"), true);
  assert.equal(isPick("draw"), true);
  assert.equal(isPick("away"), true);
  assert.equal(isPick("HOME"), false);
  assert.equal(isPick(""), false);
  assert.equal(isPick(null), false);
  assert.equal(isPick(2), false);
});

test("finalGoalsFromScores reads only the CURRENT total, ignoring period splits", () => {
  // A realistic SportMonks v3 scores array: per-period entries PLUS the running
  // CURRENT total. Summing the periods would give 3-2; the CURRENT total is the
  // truth (2-1). We must read CURRENT and ignore the rest.
  const scores: SmScoreEntry[] = [
    { description: "1ST_HALF", score: { goals: 1, participant: "home" } },
    { description: "1ST_HALF", score: { goals: 0, participant: "away" } },
    { description: "2ND_HALF", score: { goals: 1, participant: "home" } },
    { description: "2ND_HALF", score: { goals: 1, participant: "away" } },
    { description: "CURRENT", score: { goals: 2, participant: "home" } },
    { description: "CURRENT", score: { goals: 1, participant: "away" } },
  ];
  assert.deepEqual(finalGoalsFromScores(scores), { home: 2, away: 1 });
  assert.equal(resultFromGoals(2, 1), "home");
});

test("finalGoalsFromScores handles a goalless draw", () => {
  const scores: SmScoreEntry[] = [
    { description: "CURRENT", score: { goals: 0, participant: "home" } },
    { description: "CURRENT", score: { goals: 0, participant: "away" } },
  ];
  assert.deepEqual(finalGoalsFromScores(scores), { home: 0, away: 0 });
});

test("finalGoalsFromScores returns null when a side is missing or input is junk", () => {
  assert.equal(finalGoalsFromScores(null), null);
  assert.equal(finalGoalsFromScores(undefined), null);
  assert.equal(finalGoalsFromScores([]), null);
  assert.equal(
    finalGoalsFromScores([{ description: "CURRENT", score: { goals: 1, participant: "home" } }]),
    null, // away missing
  );
  assert.equal(
    finalGoalsFromScores([{ description: "1ST_HALF", score: { goals: 1, participant: "home" } }]),
    null, // no CURRENT at all
  );
});

test("tallyPicks counts and totals, skipping anything unexpected", () => {
  const picks = [
    { pick: "home" as const }, { pick: "home" as const }, { pick: "home" as const },
    { pick: "draw" as const },
    { pick: "away" as const }, { pick: "away" as const },
  ];
  assert.deepEqual(tallyPicks(picks), { home: 3, draw: 1, away: 2, total: 6 });
});

test("tallyPercent rounds and never divides by zero", () => {
  const t = tallyPicks([
    { pick: "home" as const }, { pick: "home" as const }, { pick: "home" as const },
    { pick: "away" as const },
  ]);
  assert.equal(tallyPercent(t, "home"), 75);
  assert.equal(tallyPercent(t, "away"), 25);
  assert.equal(tallyPercent(t, "draw"), 0);
  assert.equal(tallyPercent({ home: 0, draw: 0, away: 0, total: 0 }, "home"), 0);
});

test("gradePicks marks each fan correct iff they matched the result", () => {
  const graded = gradePicks(
    [
      { userId: "a", pick: "home" },
      { userId: "b", pick: "draw" },
      { userId: "c", pick: "away" },
    ],
    "home",
  );
  assert.deepEqual(graded, [
    { userId: "a", correct: true },
    { userId: "b", correct: false },
    { userId: "c", correct: false },
  ]);
});

test("copy sells the call and never leaks a score", () => {
  assert.equal(optionLabel("home", "Arsenal", "Chelsea"), "Arsenal win");
  assert.equal(optionLabel("away", "Arsenal", "Chelsea"), "Chelsea win");
  assert.equal(optionLabel("draw", "Arsenal", "Chelsea"), "Draw");

  assert.equal(
    pendingLine("home", "Arsenal", "Chelsea"),
    "You called it: Arsenal win. Back at full time.",
  );

  assert.equal(
    settledLine("home", "home", "Arsenal", "Chelsea"),
    "Full time: Arsenal win. You called it. ✅",
  );
  assert.equal(
    settledLine("draw", "home", "Arsenal", "Chelsea"),
    "Full time: Arsenal win. Not this time. ❌",
  );
  assert.equal(
    settledLine(null, "away", "Arsenal", "Chelsea"),
    "Full time: Chelsea win.",
  );

  // No copy path contains a digit — a scoreline can never leak through it.
  for (const s of [
    pendingLine("home", "Arsenal", "Chelsea"),
    settledLine("home", "home", "Arsenal", "Chelsea"),
    settledLine("away", "draw", "Arsenal", "Chelsea"),
  ]) {
    assert.equal(/\d/.test(s), false, `copy leaked a digit: "${s}"`);
  }
});

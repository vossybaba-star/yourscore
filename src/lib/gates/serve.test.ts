/**
 * Serving-layer tests: per-user variation, client stripping, grading, budget.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GateQuestion, Position } from "./types";
import {
  budgetWeight,
  buildRound,
  clientView,
  formationSlots,
  grade,
  roundBudget,
} from "./serve";

/** A synthetic pool: `n` questions per position, unique answers/prompts. */
function pool(perPos: number): GateQuestion[] {
  const out: GateQuestion[] = [];
  let id = 1;
  for (const pos of ["GK", "DEF", "MID", "FWD"] as Position[]) {
    for (let i = 0; i < perPos; i++) {
      const a = id++;
      const b = id++;
      out.push({
        format: "higher-lower",
        stat: "goals",
        prompt: `Q${pos}${i}: who has more goals?`,
        options: [
          { id: a, label: `P${a}` },
          { id: b, label: `P${b}` },
        ],
        answerId: a,
        difficulty: (i * 17) % 100,
        positions: [pos],
      });
    }
  }
  return out;
}

test("formationSlots parses shapes", () => {
  assert.deepEqual(formationSlots("4-3-3").join(","), "GK,DEF,DEF,DEF,DEF,MID,MID,MID,FWD,FWD,FWD");
  assert.equal(formationSlots("3-5-2").filter((p) => p === "MID").length, 5);
  assert.equal(formationSlots("junk").length, 11); // falls back to 4-3-3
});

test("buildRound: 11 position-matched questions, no reused answers/prompts", () => {
  const round = buildRound(pool(20), { gameweek: "gw1", userId: "alice" });
  assert.equal(round.questions.length, 11);
  const answers = new Set(round.questions.map((q) => q.answerId));
  assert.equal(answers.size, 11, "no answer player repeats");
  const prompts = new Set(round.questions.map((q) => q.prompt));
  assert.equal(prompts.size, 11, "no prompt repeats");
  // Position coverage matches the formation
  const served = clientView(round);
  const posCount = new Map<string, number>();
  for (const s of served) posCount.set(s.position, (posCount.get(s.position) ?? 0) + 1);
  assert.equal(posCount.get("GK"), 1);
  assert.equal(posCount.get("DEF"), 4);
  assert.equal(posCount.get("MID"), 3);
  assert.equal(posCount.get("FWD"), 3);
});

test("per-user variation: different users get different rounds; same user stable", () => {
  const p = pool(30);
  const a1 = buildRound(p, { gameweek: "gw1", userId: "alice" });
  const a2 = buildRound(p, { gameweek: "gw1", userId: "alice" });
  const b = buildRound(p, { gameweek: "gw1", userId: "bob" });
  const gw2 = buildRound(p, { gameweek: "gw2", userId: "alice" });
  assert.deepEqual(a1.questions, a2.questions, "same user+gw → same round (resume-safe)");
  assert.notDeepEqual(a1.questions, b.questions, "different user → different round");
  assert.notDeepEqual(a1.questions, gw2.questions, "different gameweek → different round");
});

test("clientView strips answers and meta", () => {
  const round = buildRound(pool(20), { gameweek: "gw1", userId: "alice" });
  const served = clientView(round);
  for (const s of served) {
    assert.equal("answerId" in s, false);
    assert.equal("meta" in s, false);
    assert.equal("difficulty" in s, false, "difficulty hidden too (no cherry-picking)");
    assert.ok(s.options.length >= 2);
  }
});

test("grade: correct/incorrect/invalid handled server-side", () => {
  const round = buildRound(pool(20), { gameweek: "gw1", userId: "alice" });
  const q = round.questions[0];
  const wrongOption = q.options.find((o) => o.id !== q.answerId)!;
  assert.equal(grade(round, 0, q.answerId)?.correct, true);
  assert.equal(grade(round, 0, wrongOption.id)?.correct, false);
  assert.equal(grade(round, 0, 999999), null, "not an offered option");
  assert.equal(grade(round, 99, q.answerId), null, "bad index");
});

test("budget: harder correct answers pay more; wrong pays nothing", () => {
  assert.equal(budgetWeight(0), 1);
  assert.equal(budgetWeight(100), 2);
  const budget = roundBudget(
    [
      { correct: true, difficulty: 0 }, // 5.0
      { correct: true, difficulty: 100 }, // 10.0
      { correct: false, difficulty: 100 }, // 0
    ],
    5,
  );
  assert.equal(budget, 15);
});

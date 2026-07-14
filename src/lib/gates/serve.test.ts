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

test("clientView: who-am-i ships the flag + shirt clues, and NEVER the answer", () => {
  // The generator keeps nationality/shirt out of the prompt text so they can be
  // rendered as visuals. If clientView drops them the question degrades to
  // "I'm a midfielder. I'm 32." — unanswerable. If it spreads meta instead, it
  // hands over `answer` and a photo of the player's face.
  const q: GateQuestion = {
    format: "who-am-i",
    prompt: "I'm a midfielder.\nI'm 32.",
    options: [
      { id: 1, label: "Kevin De Bruyne" },
      { id: 2, label: "\u0130lkay G\u00fcndo\u011fan" },
      { id: 3, label: "Jordan Henderson" },
      { id: 4, label: "James Milner" },
    ],
    answerId: 1,
    difficulty: 50,
    positions: ["MID"],
    meta: {
      answer: "De Bruyne",
      club: "MCI",
      nationality: "Belgium",
      jersey: 17,
      flag: "https://cdn.example/be.png",
      photo: "https://cdn.example/kdb.png",
    },
  };
  const [view] = clientView({ seed: "s", questions: [q], positions: ["MID"] });

  assert.deepEqual(view.clues, {
    nationality: "Belgium",
    flag: "https://cdn.example/be.png",
    jersey: 17,
  });

  const wire = JSON.stringify(view);
  assert.ok(!wire.includes("kdb.png"), "the player's photo would give the answer away");
  assert.ok(!/"answer"/.test(wire), "meta.answer must never reach the client");
  assert.equal("answerId" in view, false, "answerId is never served");
});

test("clientView: non who-am-i formats carry no clues", () => {
  const round = buildRound(pool(20), { gameweek: "gw1", userId: "bob" });
  for (const s of clientView(round)) {
    if (s.format !== "who-am-i") assert.equal(s.clues, undefined);
  }
});

/**
 * Unit tests for the factual-safety gates. No network, no DB, no deps:
 *   node --test scripts/halftime/claims.test.mjs
 *
 * These are the rules a wrong answer has to get past to reach a user who is
 * watching the actual match, so they get tested like it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstHalfViolations,
  anchorViolations,
  currentAffairsViolations,
  entityViolations,
  buildNameIndex,
  shapeViolations,
  groundingViolations,
  textViolations,
  extractCapitalisedRuns,
  hasPreKickoffAnchor,
  isMutable,
  answerLeakViolations,
} from "./lib/claims.mjs";
import { computeDeadline } from "./veto.mjs";

const XI = ["Bukayo Saka", "David Raya", "Kai Havertz", "Jordan Pickford", "Iliman Ndiaye", "Gabriel Magalhães"];
const CLUBS = ["Arsenal", "Everton", "Premier League", "Emirates Stadium"];
const IDX = buildNameIndex(XI, CLUBS);

const q = (over = {}) => ({
  question: "Which of these players has scored most against Everton?",
  options: { A: "Bukayo Saka", B: "Kai Havertz", C: "David Raya", D: "Gabriel Magalhães" },
  answer: "A",
  difficulty: "medium",
  claims: [{ type: "player_goals_vs", player_id: 1, name: "Bukayo Saka", value: 3 }],
  named_entities: ["Bukayo Saka", "Kai Havertz", "David Raya", "Gabriel Magalhães"],
  ...over,
});

// ── The first-half ban ───────────────────────────────────────────────────────

test("first-half ban: catches the obvious live references", () => {
  const bad = [
    "Who opened the scoring today?",
    "What is the scoreline at half time?",
    "Who was booked in the first half?",
    "Which player was substituted in the 31st minute?",
    "How many goals has Arsenal currently scored?",
    "Who is leading at the break?",
  ];
  for (const t of bad) {
    assert.ok(firstHalfViolations(t).length > 0, `should have been caught: ${t}`);
  }
});

test("first-half ban: does NOT fire on legitimate pre-kickoff history", () => {
  const good = [
    "Who scored Arsenal's winner against Everton in December 2025?",
    "Which of these started for Everton in the 2015/16 season?",
    "Bukayo Saka has scored how many goals against Everton before kick-off today?",
  ];
  for (const t of good) {
    assert.deepEqual(firstHalfViolations(t), [], `false positive: ${t}`);
  }
});

// ── The anchor rule — the subtle one ─────────────────────────────────────────

test("anchor: an unanchored running total is a first-half dependency and is dropped", () => {
  const claims = [{ type: "player_stat", stat: "goals", value: 7, name: "Bukayo Saka" }];
  assert.ok(isMutable(claims[0]));
  const v = anchorViolations("How many league goals has Bukayo Saka scored?", claims);
  assert.equal(v.length, 1);
  assert.match(v[0], /no pre-kickoff anchor/);
});

test("anchor: the same question survives once it is frozen before kick-off", () => {
  const claims = [{ type: "player_stat", stat: "goals", value: 7, name: "Bukayo Saka" }];
  for (const phrasing of [
    "How many league goals had Bukayo Saka scored before kick-off today?",
    "Going into this match, how many goals had Bukayo Saka scored?",
    "Coming into today's game, how many appearances had he made?",
  ]) {
    assert.deepEqual(anchorViolations(phrasing, claims), [], phrasing);
  }
});

test("anchor: immutable claims need no anchor", () => {
  const claims = [{ type: "player_career_club", name: "Kai Havertz", team_id: 13 }];
  assert.equal(isMutable(claims[0]), false);
  assert.deepEqual(anchorViolations("Which of these has played for Everton?", claims), []);
});

test("anchor phrases are recognised", () => {
  assert.ok(hasPreKickoffAnchor("before kick-off today"));
  assert.ok(hasPreKickoffAnchor("going into this match"));
  assert.equal(hasPreKickoffAnchor("this season so far"), false);
});

// ── The stale-fact ban (base pass) ───────────────────────────────────────────

test("base pass: bans the exact class of claim the founder was burned by", () => {
  // The real incident: the model asserted a manager was still at a club he had left.
  const v = currentAffairsViolations("Who is Arsenal's manager?");
  assert.ok(v.some((r) => /manager.*no historical anchor/.test(r)));
});

test("base pass: a manager question anchored to a year is history, and is fine", () => {
  assert.deepEqual(currentAffairsViolations("Who managed Arsenal in the 2003/04 unbeaten season?"), []);
});

test("base pass: form, injuries, position and 'this season' are all banned", () => {
  assert.ok(currentAffairsViolations("Who is currently top of the table?").length);
  assert.ok(currentAffairsViolations("Which Everton player is injured?").length);
  assert.ok(currentAffairsViolations("How many goals this season?").length);
  assert.ok(currentAffairsViolations("Who was Arsenal's new signing in the transfer window?").length);
});

// ── The named-entity whitelist ───────────────────────────────────────────────

test("entities: a player outside the dossier is caught even when undeclared", () => {
  const bad = q({
    question: "Which of these has scored most against Everton?",
    options: { A: "Bukayo Saka", B: "Cristiano Ronaldo", C: "David Raya", D: "Kai Havertz" },
    named_entities: ["Bukayo Saka", "David Raya", "Kai Havertz"], // Ronaldo NOT declared
  });
  const v = entityViolations(bad.question, bad.options, IDX, bad.named_entities);
  assert.ok(v.some((r) => /Cristiano Ronaldo/.test(r)), JSON.stringify(v));
});

test("entities: the whitelisted XI passes, accents and all", () => {
  assert.deepEqual(entityViolations(q().question, q().options, IDX, q().named_entities), []);
  assert.deepEqual(
    entityViolations("Gabriel Magalhães starts today.", { A: "Iliman Ndiaye", B: "David Raya", C: "Kai Havertz", D: "Bukayo Saka" }, IDX, []),
    [],
  );
});

test("entities: surnames of whitelisted players resolve", () => {
  assert.deepEqual(entityViolations("Which club did Havertz join Arsenal from?", {}, IDX, []), []);
});

test("entities: ordinary capitalised words are not treated as people", () => {
  const v = entityViolations(
    "In the Premier League, which of these started at the Emirates Stadium?",
    { A: "David Raya", B: "Bukayo Saka", C: "Kai Havertz", D: "Jordan Pickford" },
    IDX,
    [],
  );
  assert.deepEqual(v, []);
});

test("capitalised-run extraction handles multi-word and accented names", () => {
  const runs = extractCapitalisedRuns("Gabriel Magalhães and Jurriën Timber started for Arsenal.");
  assert.ok(runs.some((r) => r.includes("Magalhães")));
  assert.ok(runs.some((r) => r.includes("Timber")));
});

// ── Shape + grounding ────────────────────────────────────────────────────────

test("shape: the answer must be authored as A (the shuffle happens at publish)", () => {
  assert.ok(shapeViolations(q({ answer: "C" })).some((r) => /authored as "A"/.test(r)));
  assert.deepEqual(shapeViolations(q()), []);
});

test("shape: duplicate options are rejected", () => {
  const bad = q({ options: { A: "Bukayo Saka", B: "Bukayo Saka", C: "David Raya", D: "Kai Havertz" } });
  assert.ok(shapeViolations(bad).some((r) => /distinct/.test(r)));
});

test("grounding: a question with no claims is ungrounded by definition", () => {
  assert.ok(groundingViolations([]).length);
  assert.ok(groundingViolations([{ type: "vibes" }]).some((r) => /unknown claim type/.test(r)));
});

// ── The composite gate ───────────────────────────────────────────────────────

test("composite: a clean fresh question survives every text gate", () => {
  assert.deepEqual(textViolations(q(), { pass: "fresh", nameIndex: IDX }), []);
});

test("composite: one hallucinated name is enough to kill the question", () => {
  const bad = q({ options: { A: "Bukayo Saka", B: "Lionel Messi", C: "David Raya", D: "Kai Havertz" } });
  assert.ok(textViolations(bad, { pass: "fresh", nameIndex: IDX }).length > 0);
});

test("composite: a first-half reference in an OPTION kills the question", () => {
  const bad = q({ options: { A: "Bukayo Saka", B: "The player booked in the 31st minute", C: "David Raya", D: "Kai Havertz" } });
  assert.ok(textViolations(bad, { pass: "fresh", nameIndex: IDX }).length > 0);
});

// ── The veto deadline ────────────────────────────────────────────────────────

test("deadline: a normal team sheet gives the founder the full window, closing by T-10", () => {
  const ko = new Date("2026-08-22T14:00:00Z");
  const sent = ko.getTime() - 60 * 60_000; // T-60
  const d = new Date(computeDeadline(sent, ko.toISOString()));
  assert.equal(d.toISOString(), new Date(ko.getTime() - 10 * 60_000).toISOString());
});

test("deadline: a LATE team sheet shrinks the window but never past the T-5 floor", () => {
  const ko = new Date("2026-08-22T14:00:00Z");
  const sent = ko.getTime() - 8 * 60_000; // sheets at T-8: brutal
  const d = new Date(computeDeadline(sent, ko.toISOString()));
  assert.equal(d.toISOString(), new Date(ko.getTime() - 5 * 60_000).toISOString());
  assert.ok(d.getTime() < ko.getTime(), "the gate must close before kick-off, always");
});

test("deadline: an early team sheet still gives at least the configured window", () => {
  const ko = new Date("2026-08-22T14:00:00Z");
  const sent = ko.getTime() - 12 * 60_000; // T-12: T-10 would be only 2 minutes
  const d = new Date(computeDeadline(sent, ko.toISOString()));
  assert.ok(d.getTime() - sent >= 5 * 60_000, "founder gets a usable window");
  assert.ok(d.getTime() <= ko.getTime() - 5 * 60_000, "never past the floor");
});

// ── Sentence-initial words: the real-run regression ──────────────────────────

test("entities: an ordinary sentence opener is not mistaken for a player", () => {
  // This exact question was dropped in the first real run because "Among" was
  // read as a hallucinated player called Among.
  const v = entityViolations(
    "Among these four Everton starters facing Arsenal today, only one has a goal against them on record. Which player is it?",
    { A: "Iliman Ndiaye", B: "Beto", C: "James Garner", D: "Jake O'Brien" },
    buildNameIndex(["Iliman Ndiaye", "Beto", "James Garner", "Jake O'Brien"], ["Arsenal", "Everton"]),
    [],
  );
  assert.deepEqual(v, []);
});

test("entities: a hallucinated player at the START of a sentence is still caught", () => {
  const v = entityViolations(
    "Messi has scored more than which of these starters?",
    { A: "Bukayo Saka", B: "David Raya", C: "Kai Havertz", D: "Jordan Pickford" },
    IDX,
    [],
  );
  assert.ok(v.some((r) => /Messi/.test(r)), JSON.stringify(v));
});

test("entities: 'starting XI' is football, not a player called XI", () => {
  const v = entityViolations("Arsenal have named their starting XI in a 4-2-3-1 today.", {}, IDX, []);
  assert.deepEqual(v, []);
});

// ── The answer leak (found on the first real generation run) ──────────────────

test("answer leak: a question that names its own answer is thrown away", () => {
  // The model actually wrote this. Every claim in it resolves; it is still broken.
  const leaky = q({
    question:
      "Bukayo Saka starts against Everton today, and remarkably he's the only one of these four Arsenal starters who has ever scored against them. Who is it?",
    options: { A: "Bukayo Saka", B: "David Raya", C: "Kai Havertz", D: "Jordan Pickford" },
  });
  const v = answerLeakViolations(leaky);
  assert.equal(v.length, 1);
  assert.match(v[0], /appears in the question/);
  assert.ok(textViolations(leaky, { pass: "fresh", nameIndex: IDX }).length > 0);
});

test("answer leak: a surname alone in the stem gives it away just as completely", () => {
  const leaky = q({
    question: "Saka is one of these. Which of them has scored against Everton?",
    options: { A: "Bukayo Saka", B: "David Raya", C: "Kai Havertz", D: "Jordan Pickford" },
  });
  assert.ok(answerLeakViolations(leaky).length);
});

test("answer leak: naming a DISTRACTOR in the stem is fine", () => {
  const ok = q({
    question: "David Raya is in goal. Which outfield starter has scored against Everton?",
    options: { A: "Bukayo Saka", B: "Kai Havertz", C: "Gabriel Magalhães", D: "Jordan Pickford" },
  });
  assert.deepEqual(answerLeakViolations(ok), []);
});

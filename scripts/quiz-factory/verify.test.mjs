/**
 * Gate tests — pure logic, no DB, no model calls.
 *
 *   node --test scripts/quiz-factory/verify.test.mjs
 *
 * These are the cases the gate exists for. If any of them regress, the factory is
 * shipping the same class of question that got 31,541 rows retired.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTemporal, checkShape, findDuplicate, gradeVerdict, isAmbiguous } from "./verify.mjs";

const q = (over = {}) => ({
  question: "Who scored Arsenal's winning goal in the 2020 FA Cup final?",
  options: { A: "Pierre-Emerick Aubameyang", B: "Alexandre Lacazette", C: "Nicolas Pepe", D: "Bukayo Saka" },
  answer: "A",
  difficulty: "medium",
  entity: "Arsenal",
  ...over,
});

// ── Stage 0a: temporal claims ────────────────────────────────────────────────
// The #1 failure mode: the model asserts a stale fact as current truth.

test("rejects time-relative phrasing outright", () => {
  for (const bad of [
    "Who is Arsenal's current captain?",
    "Which club does Declan Rice currently play for?",
    "How many goals has Haaland scored this season?",
    "Who is the reigning Premier League champion?",
    "Which player has Arsenal recently signed?",
    "Is Mikel Arteta still the Arsenal manager?",
  ]) {
    const r = checkTemporal(bad);
    assert.equal(r.ok, false, `should have rejected: ${bad}`);
    assert.match(r.reason, /^temporal:/);
  }
});

test("rejects present-tense state with no year anchor", () => {
  const r = checkTemporal("Who manages Arsenal?");
  assert.equal(r.ok, false);
  assert.match(r.reason, /no year\/season anchor/);
});

test("ALLOWS present-tense state when anchored to a season", () => {
  assert.equal(checkTemporal("Who managed Arsenal in the 2003/04 season?").ok, true);
  assert.equal(checkTemporal("Which club did Thierry Henry play for in 2005?").ok, true);
});

test("allows fixed historical facts, and does not flag them time-sensitive", () => {
  const r = checkTemporal("Who scored Arsenal's winning goal in the 2020 FA Cup final?");
  assert.equal(r.ok, true);
  assert.equal(r.timeSensitive, false);
});

test("allows all-time superlatives but FLAGS them time-sensitive", () => {
  // These are the good questions — banning them would gut the Legends category. But a
  // record can be broken, so they must be re-confirmed as still true and date-stamped.
  const r = checkTemporal("Who is Arsenal's all-time leading goalscorer?");
  assert.equal(r.ok, true);
  assert.equal(r.timeSensitive, true);
});

// ── Stage 0b: option sanity ──────────────────────────────────────────────────

test("rejects duplicate options", () => {
  const r = checkShape(q({ options: { A: "Aubameyang", B: "Aubameyang", C: "Pepe", D: "Saka" } }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /two options are the same/);
});

test("rejects hedge options", () => {
  const r = checkShape(q({ options: { A: "Henry", B: "Bergkamp", C: "Wright", D: "All of the above" } }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /hedge option/);
});

test("rejects mixed-type options (the odd one out is a giveaway)", () => {
  const r = checkShape(q({ options: { A: "49", B: "38", C: "42", D: "Arsène Wenger" }, answer: "A" }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /mixed types/);
});

test("accepts four numeric options", () => {
  assert.equal(checkShape(q({ options: { A: "49", B: "38", C: "42", D: "26" }, answer: "A" })).ok, true);
});

test("rejects a bad difficulty and a bad answer letter", () => {
  assert.equal(checkShape(q({ difficulty: "impossible" })).ok, false);
  assert.equal(checkShape(q({ answer: "E" })).ok, false);
});

// ── Stage 0c: dedupe ─────────────────────────────────────────────────────────

test("catches an exact duplicate against the bank", () => {
  const bank = [{ id: "x1", entity: "Arsenal", question: q().question, options: q().options, answer: "A" }];
  const hit = findDuplicate(q(), bank);
  assert.equal(hit?.kind, "exact");
});

test("catches a paraphrase as a near-duplicate", () => {
  const bank = [{
    id: "x2", entity: "Arsenal",
    question: "Which player holds the record for the most appearances for Arsenal?",
    options: { A: "David O'Leary", B: "Tony Adams", C: "Thierry Henry", D: "Pat Rice" }, answer: "A",
  }];
  const candidate = {
    entity: "Arsenal",
    question: "Who has made the most appearances for Arsenal?",
    options: { A: "David O'Leary", B: "Tony Adams", C: "Thierry Henry", D: "Pat Rice" }, answer: "A",
  };
  assert.equal(findDuplicate(candidate, bank)?.kind, "near");
});

test("does NOT merge two questions about different seasons", () => {
  // Identical phrasing, different year — these are different questions. The digit-token
  // guard is what stops the near-dup pass from eating a whole category.
  const bank = [{
    id: "x3", entity: "Arsenal",
    question: "Who was Arsenal's top scorer in the 2015/16 season?",
    options: { A: "Olivier Giroud", B: "Theo Walcott", C: "Alexis Sanchez", D: "Mesut Ozil" }, answer: "A",
  }];
  const candidate = {
    entity: "Arsenal",
    question: "Who was Arsenal's top scorer in the 2016/17 season?",
    options: { A: "Olivier Giroud", B: "Theo Walcott", C: "Alexis Sanchez", D: "Mesut Ozil" }, answer: "A",
  };
  assert.equal(findDuplicate(candidate, bank), null);
});

test("does not dedupe across different entities", () => {
  const bank = [{ id: "x4", entity: "Chelsea", question: q().question, options: q().options, answer: "A" }];
  assert.equal(findDuplicate(q(), bank), null);
});

// ── Stage 2: the verdict grader ──────────────────────────────────────────────
// The verifier is never told the author's answer, so it cannot rubber-stamp.

const good = {
  derived_answer: "A", confidence: "high",
  source_url: "https://www.arsenal.com/history", source_quote: "Aubameyang scored twice...",
  still_true_today: "n/a", ambiguity: null,
};

test("passes a clean verdict", () => {
  assert.equal(gradeVerdict(q(), good).verified, true);
});

test("DROPS on disagreement — the whole point of an independent verifier", () => {
  const r = gradeVerdict(q(), { ...good, derived_answer: "B" });
  assert.equal(r.verified, false);
  assert.match(r.reason, /DISAGREEMENT/);
});

test("drops when the verifier could not settle it", () => {
  assert.equal(gradeVerdict(q(), { ...good, derived_answer: "UNKNOWN" }).verified, false);
});

test("drops when no source is cited", () => {
  assert.equal(gradeVerdict(q(), { ...good, source_url: null }).verified, false);
});

test("drops on low confidence even when the answer agrees", () => {
  assert.equal(gradeVerdict(q(), { ...good, confidence: "low" }).verified, false);
});

test("drops when two options could both be defended", () => {
  const r = gradeVerdict(q(), { ...good, ambiguity: "Lacazette also scored in that final" });
  assert.equal(r.verified, false);
  assert.match(r.reason, /ambiguous/);
});

test("does NOT drop when the verifier says 'None' in prose (real regression)", () => {
  // The Italy-1970 case from the first live batch: verifier CONFIRMED the answer but wrote
  // its no-ambiguity note as prose starting with "None". That must not read as ambiguity.
  assert.equal(isAmbiguous(null), false);
  assert.equal(isAmbiguous("null"), false);
  assert.equal(isAmbiguous("None"), false);
  assert.equal(isAmbiguous("n/a"), false);
  assert.equal(isAmbiguous("No ambiguity — the records are explicit"), false);
  assert.equal(isAmbiguous("None - FIFA's own records explicitly list 'Rivera (111)' as the final goal"), false);

  const r = gradeVerdict(q(), { ...good, ambiguity: "None - the records are explicit that Aubameyang scored" });
  assert.equal(r.verified, true);
});

test("STILL drops on a real described ambiguity", () => {
  assert.equal(isAmbiguous("Lacazette also scored, so B is defensible"), true);
  assert.equal(isAmbiguous("Both A and C could be argued depending on the source"), true);
});

test("drops a time-sensitive claim the verifier could not confirm still holds", () => {
  const r = gradeVerdict(q(), { ...good, still_true_today: false }, { timeSensitive: true });
  assert.equal(r.verified, false);
  assert.match(r.reason, /still true today/);
});

test("passes a time-sensitive claim confirmed as still true", () => {
  assert.equal(gradeVerdict(q(), { ...good, still_true_today: true }, { timeSensitive: true }).verified, true);
});

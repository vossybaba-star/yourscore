/**
 * Tests for the facts-first additions: specificity, source tiering, difficulty guards.
 *
 *   node --test scripts/quiz-factory/facts-first.test.mjs
 *
 * Pure logic — no DB, no model calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSpecificity } from "./verify.mjs";
import { sourceTier, isTrustedSource } from "./sources.mjs";
import { applyGuards, numericTightness, seasonYear, LEVELS } from "./difficulty.mjs";

// ── Specificity: "anyone could be reading these at any time" ──────────────────
// Now that we hold PL *and* European data for the same club and season, a question that
// doesn't name the competition has two different correct answers.

test("rejects scope-dependent questions that don't name the competition", () => {
  for (const bad of [
    "Who was Arsenal's top scorer in the 2015/16 season?",
    "Where did Liverpool finish in the 2019/20 season?",
    "How many points did Arsenal get in the 2015/16 season?",
    "Who was Chelsea's leading scorer in 2016/17?",
  ]) {
    const r = checkSpecificity(bad);
    assert.equal(r.ok, false, `should have rejected: ${bad}`);
    assert.match(r.reason, /^specificity:/);
  }
});

test("ACCEPTS the same questions once the competition is named", () => {
  for (const good of [
    "Who was Arsenal's top scorer in the 2015/16 Premier League season?",
    "Who was Arsenal's top scorer in the 2015/16 Champions League?",
    "Where did Liverpool finish in the 2019/20 Premier League season?",
    "How many points did Arsenal finish with in the 2015/16 Premier League season?",
  ]) {
    assert.equal(checkSpecificity(good).ok, true, `should have accepted: ${good}`);
  }
});

test("the league/Europe pair is exactly why this rule exists", () => {
  // Same club, same season, same question shape — different competitions, different answers.
  assert.equal(checkSpecificity("Who was Liverpool's top scorer in the 2004/05 season?").ok, false);
  assert.equal(checkSpecificity("Who was Liverpool's top scorer in the 2004/05 Champions League?").ok, true);
  assert.equal(checkSpecificity("Who was Liverpool's top scorer in the 2004/05 Premier League season?").ok, true);
});

test("allows questions that aren't scope-dependent", () => {
  // No competition needed — the answer doesn't change by competition.
  assert.equal(checkSpecificity("In what year were Arsenal founded?").ok, true);
  assert.equal(checkSpecificity("What is the name of Chelsea's home stadium?").ok, true);
});

// ── Source tiering: a fact from a blog is not a fact ──────────────────────────

test("tier 1 = governing bodies, competition organisers, official club sites", () => {
  assert.equal(sourceTier("https://www.premierleague.com/stats"), 1);
  assert.equal(sourceTier("https://www.uefa.com/uefachampionsleague/"), 1);
  assert.equal(sourceTier("https://www.thefa.com/news/2020/aug/01/final"), 1);
  assert.equal(sourceTier("https://www.arsenal.com/history"), 1);
  assert.equal(sourceTier("https://www.liverpoolfc.com/history"), 1);
});

test("tier 2 = major press and established reference", () => {
  assert.equal(sourceTier("https://www.bbc.co.uk/sport/football/123"), 2);
  assert.equal(sourceTier("https://www.theguardian.com/football/2020"), 2);
  assert.equal(sourceTier("https://en.wikipedia.org/wiki/Arsenal_F.C."), 2);
  assert.equal(sourceTier("https://www.transfermarkt.com/arsenal"), 2);
});

test("everything else is untrusted — treated as NO source", () => {
  for (const bad of [
    "https://random-football-blog.wordpress.com/post",
    "https://www.reddit.com/r/Gunners/comments/x",
    "https://arsenal-fan-wiki.fandom.com/wiki/History",
    "https://www.youtube.com/watch?v=x",
    "https://some-betting-site.com/odds",
  ]) {
    assert.equal(sourceTier(bad), 0, `should be untrusted: ${bad}`);
    assert.equal(isTrustedSource(bad), false);
  }
});

test("garbage URLs are untrusted, not crashes", () => {
  assert.equal(sourceTier(null), 0);
  assert.equal(sourceTier(""), 0);
  assert.equal(sourceTier("not a url"), 0);
});

test("a lookalike domain does not sneak through", () => {
  // Substring matching would wrongly pass these. Host matching must be exact-or-subdomain.
  assert.equal(sourceTier("https://bbc.co.uk.evil.com/fake"), 0);
  assert.equal(sourceTier("https://fake-premierleague.com/x"), 0);
  // But real subdomains are fine.
  assert.equal(sourceTier("https://www.bbc.co.uk/sport"), 2);
});

// ── Difficulty: three levels, a priori, with deterministic guards ─────────────

test("only three levels exist — expert/master are stranded by the draw", () => {
  assert.deepEqual(LEVELS, ["easy", "medium", "hard"]);
});

test("numericTightness spots precise-recall questions", () => {
  // Tight cluster: you either know it or you don't.
  const tight = numericTightness({ A: "88", B: "89", C: "90", D: "91" });
  assert.ok(tight < 0.15, `expected tight, got ${tight}`);
  // Wide spread: reasonable to narrow down.
  const wide = numericTightness({ A: "26", B: "42", C: "68", D: "91" });
  assert.ok(wide > 0.5, `expected wide, got ${wide}`);
  // Not numeric at all.
  assert.equal(numericTightness({ A: "Henry", B: "Bergkamp", C: "Wright", D: "Adams" }), null);
});

test("guard: a tightly-clustered numeric answer is never easy", () => {
  const q = { question: "How many points did Arsenal finish with in the 2023/24 Premier League season?", options: { A: "88", B: "89", C: "90", D: "91" }, answer: "B" };
  const r = applyGuards(q, "easy");
  assert.equal(r.difficulty, "hard");
  assert.ok(r.adjusted);
});

test("guard: a fact 10+ seasons old is never easy", () => {
  const q = { question: "Which club won the 2003/04 Premier League title?", options: { A: "Arsenal", B: "Chelsea", C: "Man Utd", D: "Liverpool" }, answer: "A" };
  const r = applyGuards(q, "easy");
  assert.equal(r.difficulty, "medium");
});

test("guards leave a legitimately easy recent question alone", () => {
  const q = { question: "Which club won the 2023/24 Premier League title?", options: { A: "Man City", B: "Arsenal", C: "Liverpool", D: "Chelsea" }, answer: "A" };
  const r = applyGuards(q, "easy");
  assert.equal(r.difficulty, "easy");
  assert.equal(r.adjusted, false);
});

test("guards never soften a hard rating", () => {
  const q = { question: "Which club won the 2023/24 Premier League title?", options: { A: "Man City", B: "Arsenal", C: "Liverpool", D: "Chelsea" }, answer: "A" };
  assert.equal(applyGuards(q, "hard").difficulty, "hard");
});

test("seasonYear takes the latest year referenced", () => {
  assert.equal(seasonYear("Who won the 2003/04 Premier League?"), 2003);
  assert.equal(seasonYear("Between 1998 and 2004, who..."), 2004);
  assert.equal(seasonYear("What is Chelsea's home stadium?"), null);
});

test("an unrated question defaults to medium, never to the author's claim", () => {
  const q = { question: "Some question about the 2020/21 Premier League season?", options: { A: "a", B: "b", C: "c", D: "d" }, answer: "A" };
  assert.equal(applyGuards(q, undefined).difficulty, "medium");
  assert.equal(applyGuards(q, "expert").difficulty, "medium"); // legacy value ⇒ not honoured
});

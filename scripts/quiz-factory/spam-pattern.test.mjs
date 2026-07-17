/**
 * Tests for bulk-fabrication detection. Pure logic, free.
 *
 *   node --test scripts/quiz-factory/spam-pattern.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { findSpamGroups, subjectOf, seasonOf } from "./spam-pattern.mjs";

const q = (id, entity, question, answerVal) => ({
  id, entity, question,
  options: { A: answerVal, B: "1", C: "2", D: "3" },
  answer: "A",
});

test("catches the real Watkins pattern — one tally sprayed across a decade", () => {
  // He was 6 in 2001-02 and Villa weren't in the division in 2017-18. His real 16 (2023-24)
  // was stamped onto every season.
  const rows = ["2001-02", "2002-03", "2003-04", "2017-18"].map((s, i) =>
    q(`w${i}`, "Aston Villa", `How many Premier League goals did Ollie Watkins score for Aston Villa in ${s}?`, "16")
  );
  const groups = findSpamGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, "Ollie Watkins");
  assert.equal(groups[0].seasons.length, 4);
  assert.equal(groups[0].ids.length, 4);
});

test("does NOT flag the same player across seasons with DIFFERENT answers", () => {
  // Real questions about a real career: the tally changes each season. Never spam.
  const rows = [
    q("a", "Arsenal", "How many Premier League goals did Thierry Henry score for Arsenal in 2003-04?", "30"),
    q("b", "Arsenal", "How many Premier League goals did Thierry Henry score for Arsenal in 2004-05?", "25"),
    q("c", "Arsenal", "How many Premier League goals did Thierry Henry score for Arsenal in 2005-06?", "27"),
  ];
  assert.equal(findSpamGroups(rows).length, 0);
});

test("tolerates a legitimate repeat — two seasons is a coincidence, not a pattern", () => {
  // Henry really did score 24 in both 2001-02 and 2004-05. The threshold must not punish that.
  const rows = [
    q("a", "Arsenal", "How many Premier League goals did Thierry Henry score for Arsenal in 2001-02?", "24"),
    q("b", "Arsenal", "How many Premier League goals did Thierry Henry score for Arsenal in 2004-05?", "24"),
  ];
  assert.equal(findSpamGroups(rows).length, 0, "2 seasons is below the 3-season threshold");
});

test("does not group across different clubs", () => {
  const rows = [
    q("a", "Chelsea", "How many Premier League goals did João Pedro score for Chelsea in 2019-20?", "15"),
    q("b", "Brighton & Hove Albion", "How many Premier League goals did João Pedro score for Brighton in 2022-23?", "15"),
    q("c", "Chelsea", "How many Premier League goals did João Pedro score for Chelsea in 2020-21?", "15"),
  ];
  // Only 2 Chelsea seasons ⇒ under threshold; the Brighton one must not pad the group.
  assert.equal(findSpamGroups(rows).length, 0);
});

test("questions with no season are ignored — this pattern is season-spray", () => {
  const rows = [
    q("a", "Arsenal", "Who is Arsenal's all-time leading goalscorer?", "Thierry Henry"),
    q("b", "Arsenal", "Which player made the most appearances for Arsenal?", "Thierry Henry"),
    q("c", "Arsenal", "Who scored the winner for Arsenal?", "Thierry Henry"),
  ];
  assert.equal(findSpamGroups(rows).length, 0);
});

test("subjectOf finds the person, not the club or the question word", () => {
  assert.equal(subjectOf("How many Premier League goals did Ollie Watkins score for Aston Villa in 2001-02?"), "Ollie Watkins");
  assert.equal(subjectOf("How many Premier League goals did Erling Haaland score for Manchester City in 2006-07?"), "Erling Haaland");
  // Club-only question ⇒ no person subject.
  assert.equal(subjectOf("Where did Aston Villa finish in the Premier League in 2019-20?"), null);
});

test("seasonOf reads the usual formats", () => {
  assert.equal(seasonOf("...in 2001-02?"), "2001-02");
  assert.equal(seasonOf("...in the 2019/20 season"), "2019-20");
  assert.equal(seasonOf("Who is Arsenal's top scorer?"), null);
});

test("does NOT flag a repeated CLUB answer — a player staying put is not spam", () => {
  // Real, correct questions: Henry won the Golden Boot three times, all at Arsenal. The answer
  // repeats because it's TRUE. Flagging these was a genuine false positive.
  const rows = ["2003-04", "2004-05", "2005-06"].map((s, i) => ({
    id: `h${i}`, entity: "Arsenal",
    question: `Which club was Thierry Henry playing for when he won the Premier League Golden Boot in ${s}?`,
    options: { A: "Arsenal", B: "Chelsea", C: "Liverpool", D: "Everton" }, answer: "A",
  }));
  assert.equal(findSpamGroups(rows).length, 0);
});

test("does NOT flag a club's own repeated points tally", () => {
  // "How many points did West Ham get in 2008-09 / 2017-18 / 2022-23?" → 42 each time is a
  // perfectly ordinary mid-table coincidence, and the subject is the club, not a person.
  const rows = ["2008-09", "2017-18", "2022-23"].map((s, i) => ({
    id: `w${i}`, entity: "West Ham United",
    question: `How many points did West Ham United finish with in the ${s} Premier League season?`,
    options: { A: "42", B: "40", C: "45", D: "38" }, answer: "A",
  }));
  assert.equal(findSpamGroups(rows).length, 0);
});

test("worst offenders come first", () => {
  const rows = [
    ...["2001-02", "2002-03", "2003-04", "2004-05", "2005-06"].map((s, i) =>
      q(`h${i}`, "Manchester City", `How many Premier League goals did Erling Haaland score for Manchester City in ${s}?`, "27")),
    ...["2009-10", "2010-11", "2011-12"].map((s, i) =>
      q(`t${i}`, "Brentford", `How many Premier League goals did Igor Thiago score for Brentford in ${s}?`, "22")),
  ];
  const groups = findSpamGroups(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].subject, "Erling Haaland", "5 seasons should outrank 3");
  assert.equal(groups[0].seasons.length, 5);
});

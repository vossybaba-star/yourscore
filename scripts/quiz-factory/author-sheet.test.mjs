/**
 * The author may only ever see facts belonging to ITS club and ITS category.
 *
 *   node --test scripts/quiz-factory/author-sheet.test.mjs
 *
 * Every case here is a real failure from the Arsenal pilot. The pipeline obeyed facts-first
 * to the letter and still produced garbage, because the facts were the wrong ones:
 *
 *   - Rivalries research returned ZERO facts. `sheet` was pre-loaded with the SportMonks
 *     league record, so the "is the sheet empty?" check passed and it authored 29 questions
 *     from league tables under a Rivalries heading — "How many goals did Manchester City's
 *     Erling Haaland score?" filed under Arsenal · Rivalries & Derbies.
 *   - Modern Era authored from the same league-wide record: 6 of 25 "Arsenal" questions were
 *     actually about City, United and Liverpool.
 *
 * Root cause was structural, not a missing check: facts ARE typed when researched, then got
 * flattened into one prompt string, and a string can't be filtered. Now they stay typed until
 * the moment of prompting, so the wrong facts can't reach an author at all — the failure is
 * unrepresentable rather than guarded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorSheet, sportmonksFacts } from "./facts.mjs";

const fact = (entity, category, text) => ({ entity, category, fact: text, key: `k-${text.slice(0, 8)}` });

test("hands over only facts for THIS club and THIS category", () => {
  const pool = [
    fact("Arsenal", "rivalries-derbies", "Arsenal and Tottenham contest the North London derby."),
    fact("Arsenal", "history-honours", "Arsenal won the Premier League title in 2003/2004."),
    fact("Manchester City", "modern-era", "Manchester City's top scorer in 2023/24 was Erling Haaland."),
  ];
  const sheet = buildAuthorSheet({ entity: "Arsenal", category: "rivalries-derbies", facts: pool });
  assert.equal(sheet.length, 1);
  assert.match(sheet[0].fact, /North London derby/);
});

test("THE REAL BUG: a Rivalries author can never be handed league facts", () => {
  // Exactly the pilot: rivalry research returned nothing, but the league record was loaded.
  const pool = [
    fact("Arsenal", "modern-era", "Arsenal finished 2 in the 2023/2024 Premier League season with 89 points."),
    fact("Arsenal", "history-honours", "Arsenal won the Premier League title in 2003/2004."),
  ];
  assert.throws(
    () => buildAuthorSheet({ entity: "Arsenal", category: "rivalries-derbies", facts: pool }),
    /no facts for Arsenal · rivalries-derbies/,
    "must refuse outright — never fall back to whatever else is loaded"
  );
});

test("the refusal says WHY, so a silent skip can't be mistaken for a clean run", () => {
  const pool = [fact("Arsenal", "modern-era", "Arsenal finished 2 in 2023/2024.")];
  assert.throws(
    () => buildAuthorSheet({ entity: "Arsenal", category: "legends", facts: pool }),
    /belong to other categories\/clubs — refusing to use them/
  );
});

test("another club's facts never leak in, even in the right category", () => {
  // The Modern Era contamination: 6 of 25 "Arsenal" questions were about other clubs.
  const pool = [
    fact("Arsenal", "modern-era", "Arsenal finished 2 in the 2023/2024 season."),
    fact("Manchester City", "modern-era", "Manchester City's top scorer in 2023/24 was Erling Haaland."),
    fact("Liverpool", "modern-era", "Liverpool won the title in 2019/2020."),
  ];
  const sheet = buildAuthorSheet({ entity: "Arsenal", category: "modern-era", facts: pool });
  assert.equal(sheet.length, 1);
  assert.ok(sheet.every((f) => f.entity === "Arsenal"));
});

test("empty pool throws rather than returning an empty sheet", () => {
  assert.throws(() => buildAuthorSheet({ entity: "Arsenal", category: "legends", facts: [] }), /no facts/);
  assert.throws(() => buildAuthorSheet({ entity: "Arsenal", category: "legends", facts: undefined }), /no facts/);
});

// ── SportMonks → typed facts ──────────────────────────────────────────────────

const sheet = {
  club: "Arsenal",
  titles: ["2003/2004"],
  european: { won: [], lost: [{ competition: "UCL", season: "2005/2006", lostTo: "FC Barcelona" }] },
  seasons: [
    { season: "2023/2024", position: 2, points: 89, scorersUsable: true,
      clubTopScorer: { player: "Bukayo Saka", goals: 16 },
      leagueTopScorer: { player: "Erling Haaland", goals: 27, team: "Manchester City" } },
    { season: "2010/2011", position: 4, points: 68, scorersUsable: true,
      clubTopScorer: { player: "Robin van Persie", goals: 18 },
      leagueTopScorer: { player: "Carlos Tevez", goals: 20, team: "Manchester City" } },
  ],
};

test("SportMonks facts NEVER carry another club's top scorer", () => {
  // The raw record lists league-wide top scorers for context. Handing those to an author is
  // precisely what produced Haaland questions inside Arsenal's set.
  const facts = sportmonksFacts(sheet, { fromYear: 2000 });
  assert.ok(facts.every((f) => f.entity === "Arsenal"), "every fact must be about Arsenal");
  assert.ok(!facts.some((f) => /Haaland|Tevez|Manchester City/.test(f.fact)), "no other club may appear");
  assert.ok(facts.some((f) => /Bukayo Saka/.test(f.fact)), "the club's OWN scorer is kept");
});

test("SportMonks facts are tagged into the right categories", () => {
  const facts = sportmonksFacts(sheet, { fromYear: 2000 });
  const cats = new Set(facts.map((f) => f.category));
  assert.ok(cats.has("modern-era"), "seasons → modern-era");
  assert.ok(cats.has("history-honours"), "titles and European finals → history-honours");
  // A league record knows nothing about rivalries or legends — it must stay silent, not pad.
  assert.ok(!cats.has("rivalries-derbies"));
  assert.ok(!cats.has("legends"));
});

test("a league record cannot supply a Rivalries sheet — it has nothing to say", () => {
  const facts = sportmonksFacts(sheet, { fromYear: 2000 });
  assert.throws(() => buildAuthorSheet({ entity: "Arsenal", category: "rivalries-derbies", facts }), /no facts/);
});

test("Modern Era honours fromYear — old seasons aren't 'modern'", () => {
  const facts = sportmonksFacts(sheet, { fromYear: 2015 });
  assert.ok(facts.some((f) => f.season === "2023/2024"));
  assert.ok(!facts.some((f) => f.season === "2010/2011" && f.category === "modern-era"));
});

test("every SportMonks fact is tier 1 and carries provenance", () => {
  for (const f of sportmonksFacts(sheet, { fromYear: 2000 })) {
    assert.equal(f.tier, 1);
    assert.equal(f.origin, "sportmonks");
    assert.ok(f.key, "needs a fact_key so same-fact questions don't share a quiz");
  }
});

/**
 * Fact-sheet integrity tests. Pure logic — no API, no DB.
 *
 *   node --test scripts/quiz-factory/factsheet.test.mjs
 *
 * These exist because a bad fact sheet is the worst failure this system has. Facts-first means
 * everything downstream is DERIVED from the sheet, so one wrong fact silently corrupts every
 * question built on it (correlated failure). It already happened once, for real:
 *
 *   SportMonks says Henry scored 17 in 2003/04. He scored 30. The sheet published 17 as a
 *   "ceiling", and a verification sweep used it to CONTRADICT AND RETIRE a correct question
 *   that answered 30. 114 questions were retired; a good share were correct. All restored.
 *
 * So: the sheet must omit data it can't trust, and must SAY what it doesn't cover — silence
 * gets read as evidence of absence ("European finals since 2000: none" was read as "Villa never
 * won a European Cup", contradicting their real 1982 win).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { factSheetText, TOPSCORER_MIN_YEAR, isTableComplete } from "../lib/sportmonks.mjs";

/** A sheet spanning the reliable/unreliable boundary. */
const sheet = (over = {}) =>
  factSheetText({
    club: "Arsenal",
    fromYear: 2000,
    titles: ["2003/2004"],
    derived: { bestFinish: 1, mostPoints: 90, mostPointsSeason: "2003/2004" },
    european: { won: [], lost: [] },
    seasons: [
      // Pre-2005: SportMonks has no usable top scorer — must be omitted, not published.
      { season: "2003/2004", position: 1, points: 90, scorersUsable: false, clubTopScorer: null, leagueTopScorer: null },
      // Post-2005: verified accurate.
      { season: "2023/2024", position: 2, points: 89, scorersUsable: true,
        clubTopScorer: { player: "Bukayo Saka", goals: 16 },
        leagueTopScorer: { player: "Erling Haaland", goals: 27, team: "Manchester City" } },
    ],
    ...over,
  });

test("the topscorer cutoff is 2005 — before that the data is absent or PARTIAL", () => {
  // 2003/04 reported Henry 17 (really 30); 2004/05 reported 7 (really 25). Partial data is
  // worse than none: it looks valid. 2005/06+ verified correct against known Golden Boots.
  assert.equal(TOPSCORER_MIN_YEAR, 2005);
});

test("a pre-2005 season publishes NO top scorer, and says so", () => {
  const s = sheet();
  const line = s.split("\n").find((l) => l.includes("2003/2004:"));
  assert.ok(line.includes("finished 1, 90 pts"), "standings are reliable and must still appear");
  assert.ok(!/top scorer \w/.test(line), `must not publish an untrusted top scorer: ${line}`);
  assert.match(line, /top-scorer data unavailable/);
});

test("a post-2005 season DOES publish its top scorer", () => {
  const line = sheet().split("\n").find((l) => l.includes("2023/2024:"));
  assert.match(line, /Bukayo Saka \(16\)/);
  assert.match(line, /Erling Haaland \(27/);
});

test("the sheet warns against inferring a ceiling where scorers are missing", () => {
  // This is the exact instruction that stops "no top scorer listed" being read as "0 goals".
  assert.match(sheet(), /Do NOT infer a goal ceiling for a season with no top scorer listed/);
});

test("the sheet states its scope — absence is not evidence of absence", () => {
  const s = sheet();
  assert.match(s, /SCOPE/);
  assert.match(s, /ONWARDS ONLY/);
  assert.match(s, /does NOT mean it didn't happen/);
  // The specific trap: Villa's 1982 European Cup is outside range and must not be "disproved".
  assert.match(s, /European Cup won in the 1980s is outside this range/);
});

test("no European finals in range is phrased as a RANGE limit, not as 'never'", () => {
  const s = sheet({ european: { won: [], lost: [] } });
  const line = s.split("\n").find((l) => l.includes("European finals reached"));
  assert.match(line, /IN THIS RANGE/);
  assert.match(line, /earlier ones are not covered/);
  assert.ok(!/^European finals reached 2000→: none\.$/.test(line), "bare 'none' reads as 'never won one'");
});

test("every honours line is stamped with the range it covers", () => {
  const s = sheet({ european: { won: [{ competition: "UCL", season: "2005/2006", beat: "Barcelona" }], lost: [] } });
  assert.match(s, /Premier League titles won \(2000→\)/);
  assert.match(s, /European trophies won \(2000→\)/);
  assert.match(s, /Best PL finish \(2000→\)/);
});

test("the sheet does not claim coverage it lacks", () => {
  const s = sheet();
  assert.match(s, /does NOT cover: anything before 2000, the FA Cup, the League Cup, transfers, or squads/);
});

// ── Missing seasons ───────────────────────────────────────────────────────────
// SportMonks returns ZERO rows for 2005/06. Dropped silently, that made a sheet list four
// Chelsea titles instead of five (they won 04/05 AND 05/06), and the sweep used it to
// contradict — and retire — a correct question answering 5. A gap must never read as a fact.

test("the PL is always 20 clubs — any other row count is incomplete data, not a short league", () => {
  assert.equal(isTableComplete(new Array(20).fill({})), true);
  assert.equal(isTableComplete([]), false, "0 rows = no data (the real 2005/06 case)");
  assert.equal(isTableComplete(new Array(19).fill({})), false, "a partial table is not a fact");
});

test("a missing season is declared LOUDLY, not dropped in silence", () => {
  const s = sheet({ missingSeasons: ["2005/2006"] });
  assert.match(s, /DATA IS MISSING for these seasons entirely: 2005\/2006/);
  assert.match(s, /Any question about those seasons is UNKNOWN, never wrong/);
});

test("totals are labelled a MINIMUM when a season is missing", () => {
  // The exact fix for Chelsea: "4 titles" is false, "at least 4, 2005/06 unknown" is honest.
  const s = sheet({ missingSeasons: ["2005/2006"], titles: ["2004/2005", "2009/2010"] });
  const line = s.split("\n").find((l) => l.includes("titles won"));
  assert.match(line, /MINIMUM/);
  assert.match(line, /excludes 2005\/2006/);
});

test("with no gaps, no missing-data warning appears", () => {
  const s = sheet({ missingSeasons: [] });
  assert.ok(!/DATA IS MISSING/.test(s));
  const line = s.split("\n").find((l) => l.includes("titles won"));
  assert.ok(!/MINIMUM/.test(line), "a complete sheet shouldn't hedge");
});

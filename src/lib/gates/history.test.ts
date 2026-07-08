/**
 * History / trivia / career-path tests. Run: `bash scripts/gates/run-tests.sh`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCareers,
  seasonStartYear,
  shortSeasonName,
  type SmSeason,
} from "./history";
import type { SmPlayer } from "./sportmonks";
import { championQuestion, eraDifficulty, generateTrivia, topScorerQuestion, type SeasonHistory } from "./trivia";
import { generateCareerPath, sequenceKey } from "./career-path";

const NOW_YEAR = 2026;

function season(id: number, name: string): SmSeason {
  return { id, name, startYear: seasonStartYear(name) };
}

function sm(id: number, name: string, clubId: number, club: string): SmPlayer {
  return { smId: id, name, clubId, club };
}

test("season name helpers", () => {
  assert.equal(seasonStartYear("2013/2014"), 2013);
  assert.equal(shortSeasonName("2013/2014"), "2013/14");
  assert.equal(seasonStartYear("junk"), 0);
});

test("buildCareers: ordered clubs, collapses stays, tracks returns", () => {
  const squads = [
    { season: season(3, "2013/2014"), players: [sm(1, "Alpha", 10, "Southampton"), sm(2, "Beta", 20, "Arsenal")] },
    { season: season(4, "2014/2015"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 20, "Arsenal")] },
    { season: season(5, "2015/2016"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 40, "Chelsea")] },
    { season: season(6, "2016/2017"), players: [sm(2, "Beta", 20, "Arsenal")] }, // return!
  ];
  const careers = buildCareers(squads);
  const alpha = careers.find((c) => c.playerId === 1)!;
  const beta = careers.find((c) => c.playerId === 2)!;
  assert.equal(sequenceKey(alpha), "Southampton → Liverpool");
  assert.equal(alpha.seasons, 3);
  assert.equal(alpha.firstYear, 2013);
  assert.equal(sequenceKey(beta), "Arsenal → Chelsea → Arsenal", "a return is a new entry");
  assert.equal(beta.seasons, 4);
});

const HISTORY: SeasonHistory = {
  season: season(3, "2013/2014"),
  standings: [
    { position: 1, teamId: 9, team: "Manchester City", points: 86 },
    { position: 2, teamId: 8, team: "Liverpool", points: 84 },
    { position: 3, teamId: 18, team: "Chelsea", points: 82 },
    { position: 4, teamId: 19, team: "Arsenal", points: 79 },
    { position: 5, teamId: 27, team: "Everton", points: 72 },
  ],
  topScorers: [
    { rank: 1, playerId: 100, name: "Luis Suárez", goals: 31 },
    { rank: 2, playerId: 101, name: "Daniel Sturridge", goals: 21 },
    { rank: 3, playerId: 102, name: "Yaya Touré", goals: 20 },
    { rank: 4, playerId: 103, name: "Wayne Rooney", goals: 17 },
  ],
};

test("championQuestion: answer = 1st, distractors = 2nd-4th of same season", () => {
  const q = championQuestion(HISTORY, { seed: "t", nowYear: NOW_YEAR })!;
  assert.ok(q);
  assert.equal(q.answerId, 9);
  assert.equal(q.prompt, "Who won the Premier League in 2013/14?");
  assert.equal(q.options.length, 4);
  const labels = q.options.map((o) => o.label).sort();
  assert.deepEqual(labels, ["Arsenal", "Chelsea", "Liverpool", "Manchester City"]);
});

test("topScorerQuestion: Suárez, rejects tied Golden Boot", () => {
  const q = topScorerQuestion(HISTORY, { seed: "t", nowYear: NOW_YEAR })!;
  assert.equal(q.answerId, 100);
  assert.ok(q.prompt.includes("top scorer in 2013/14"));
  // Tie → rejected outright
  const tied: SeasonHistory = {
    ...HISTORY,
    topScorers: HISTORY.topScorers.map((s, i) => (i === 1 ? { ...s, goals: 31 } : s)),
  };
  assert.equal(topScorerQuestion(tied, { seed: "t", nowYear: NOW_YEAR }), null);
});

test("era difficulty: older = harder; trivia deterministic", () => {
  assert.ok(eraDifficulty(2024, NOW_YEAR) < eraDifficulty(2008, NOW_YEAR));
  const a = generateTrivia([HISTORY], { seed: "same", nowYear: NOW_YEAR });
  const b = generateTrivia([HISTORY], { seed: "same", nowYear: NOW_YEAR });
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
});

test("career-path: unique sequences only, distractors differ, clean MCQ", () => {
  const squads = [
    { season: season(1, "2010/2011"), players: [sm(1, "Alpha", 10, "Southampton"), sm(2, "Beta", 20, "Arsenal"), sm(3, "Gamma", 30, "Liverpool"), sm(4, "Delta", 10, "Southampton"), sm(5, "Echo", 40, "Chelsea")] },
    { season: season(2, "2011/2012"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 20, "Arsenal"), sm(3, "Gamma", 30, "Liverpool"), sm(4, "Delta", 10, "Southampton"), sm(5, "Echo", 40, "Chelsea")] },
    { season: season(3, "2012/2013"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 40, "Chelsea"), sm(3, "Gamma", 20, "Arsenal"), sm(4, "Delta", 30, "Liverpool"), sm(5, "Echo", 40, "Chelsea")] },
  ];
  const careers = buildCareers(squads);
  const qs = generateCareerPath(careers, { seed: "c1", count: 10, nowYear: NOW_YEAR, minSeasons: 2 });
  assert.ok(qs.length > 0, "produced questions");
  const byId = new Map(careers.map((c) => [c.playerId, c]));
  for (const q of qs) {
    const answer = byId.get(q.answerId)!;
    assert.ok(answer.clubs.length >= 2, "multi-club answers only");
    assert.ok(q.prompt.startsWith("My Premier League clubs, in order:"));
    // Clean gate: exactly one option whose sequence matches the prompt's
    const promptSeq = q.prompt.replace("My Premier League clubs, in order: ", "").replace(". Who am I?", "");
    let consistent = 0;
    for (const o of q.options) {
      const c = byId.get(o.id)!;
      if (c.clubs.map((x) => x.club).join(", ") === promptSeq) consistent++;
    }
    assert.equal(consistent, 1, "exactly one option fits the sequence");
  }
});

test("career-path: single-club and duplicate-sequence players are never answers", () => {
  const squads = [
    { season: season(1, "2010/2011"), players: [sm(1, "Solo", 10, "Fulham"), sm(2, "Twin1", 20, "Arsenal"), sm(3, "Twin2", 20, "Arsenal"), sm(4, "Mover", 30, "Everton")] },
    { season: season(2, "2011/2012"), players: [sm(1, "Solo", 10, "Fulham"), sm(2, "Twin1", 40, "Chelsea"), sm(3, "Twin2", 40, "Chelsea"), sm(4, "Mover", 50, "West Ham United")] },
    { season: season(3, "2012/2013"), players: [sm(1, "Solo", 10, "Fulham"), sm(2, "Twin1", 40, "Chelsea"), sm(3, "Twin2", 40, "Chelsea"), sm(4, "Mover", 30, "Everton")] },
  ];
  const careers = buildCareers(squads);
  const qs = generateCareerPath(careers, { seed: "c2", count: 10, nowYear: NOW_YEAR, minSeasons: 2 });
  for (const q of qs) {
    assert.notEqual(q.answerId, 1, "single-club Solo never an answer");
    assert.ok(q.answerId !== 2 && q.answerId !== 3, "identical Twin sequences never answers");
    assert.equal(q.answerId, 4, "only Mover (unique multi-club) qualifies");
  }
});

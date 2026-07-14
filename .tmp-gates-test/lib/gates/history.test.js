"use strict";
/**
 * History / trivia / career-path tests. Run: `bash scripts/gates/run-tests.sh`.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_1 = require("./history");
const trivia_1 = require("./trivia");
const career_path_1 = require("./career-path");
const NOW_YEAR = 2026;
function season(id, name) {
    return { id, name, startYear: (0, history_1.seasonStartYear)(name) };
}
/** Adult player (DOB 1990 → age-filter never trips in our 2010s fixtures). */
function sm(id, name, clubId, club) {
    return { smId: id, name, clubId, club, dateOfBirth: "1990-01-01" };
}
/** Player with unknown DOB — must never be a career-path ANSWER. */
function smNoDob(id, name, clubId, club) {
    return { smId: id, name, clubId, club };
}
(0, node_test_1.test)("season name helpers", () => {
    strict_1.default.equal((0, history_1.seasonStartYear)("2013/2014"), 2013);
    strict_1.default.equal((0, history_1.shortSeasonName)("2013/2014"), "2013/14");
    strict_1.default.equal((0, history_1.seasonStartYear)("junk"), 0);
});
(0, node_test_1.test)("buildCareers: ordered clubs, collapses stays, tracks returns", () => {
    const squads = [
        { season: season(3, "2013/2014"), players: [sm(1, "Alpha", 10, "Southampton"), sm(2, "Beta", 20, "Arsenal")] },
        { season: season(4, "2014/2015"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 20, "Arsenal")] },
        { season: season(5, "2015/2016"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 40, "Chelsea")] },
        { season: season(6, "2016/2017"), players: [sm(2, "Beta", 20, "Arsenal")] }, // return!
    ];
    const careers = (0, history_1.buildCareers)(squads);
    const alpha = careers.find((c) => c.playerId === 1);
    const beta = careers.find((c) => c.playerId === 2);
    strict_1.default.equal((0, career_path_1.sequenceKey)(alpha), "Southampton → Liverpool");
    strict_1.default.equal(alpha.seasons, 3);
    strict_1.default.equal(alpha.firstYear, 2013);
    strict_1.default.equal((0, career_path_1.sequenceKey)(beta), "Arsenal → Chelsea → Arsenal", "a return is a new entry");
    strict_1.default.equal(beta.seasons, 4);
});
const HISTORY = {
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
(0, node_test_1.test)("championQuestion: answer = 1st, distractors = 2nd-4th of same season", () => {
    const q = (0, trivia_1.championQuestion)(HISTORY, { seed: "t", nowYear: NOW_YEAR });
    strict_1.default.ok(q);
    strict_1.default.equal(q.answerId, 9);
    strict_1.default.equal(q.prompt, "Who won the Premier League in 2013/14?");
    strict_1.default.equal(q.options.length, 4);
    const labels = q.options.map((o) => o.label).sort();
    strict_1.default.deepEqual(labels, ["Arsenal", "Chelsea", "Liverpool", "Manchester City"]);
});
(0, node_test_1.test)("topScorerQuestion: Suárez, rejects tied Golden Boot", () => {
    const q = (0, trivia_1.topScorerQuestion)(HISTORY, { seed: "t", nowYear: NOW_YEAR });
    strict_1.default.equal(q.answerId, 100);
    strict_1.default.ok(q.prompt.includes("top scorer in 2013/14"));
    // Tie → rejected outright
    const tied = {
        ...HISTORY,
        topScorers: HISTORY.topScorers.map((s, i) => (i === 1 ? { ...s, goals: 31 } : s)),
    };
    strict_1.default.equal((0, trivia_1.topScorerQuestion)(tied, { seed: "t", nowYear: NOW_YEAR }), null);
});
(0, node_test_1.test)("era difficulty: older = harder; trivia deterministic", () => {
    strict_1.default.ok((0, trivia_1.eraDifficulty)(2024, NOW_YEAR) < (0, trivia_1.eraDifficulty)(2008, NOW_YEAR));
    const a = (0, trivia_1.generateTrivia)([HISTORY], { seed: "same", nowYear: NOW_YEAR });
    const b = (0, trivia_1.generateTrivia)([HISTORY], { seed: "same", nowYear: NOW_YEAR });
    strict_1.default.deepEqual(a, b);
    strict_1.default.equal(a.length, 2);
});
(0, node_test_1.test)("career-path: unique sequences only, distractors differ, clean MCQ", () => {
    const squads = [
        { season: season(1, "2010/2011"), players: [sm(1, "Alpha", 10, "Southampton"), sm(2, "Beta", 20, "Arsenal"), sm(3, "Gamma", 30, "Liverpool"), sm(4, "Delta", 10, "Southampton"), sm(5, "Echo", 40, "Chelsea")] },
        { season: season(2, "2011/2012"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 20, "Arsenal"), sm(3, "Gamma", 30, "Liverpool"), sm(4, "Delta", 10, "Southampton"), sm(5, "Echo", 40, "Chelsea")] },
        { season: season(3, "2012/2013"), players: [sm(1, "Alpha", 30, "Liverpool"), sm(2, "Beta", 40, "Chelsea"), sm(3, "Gamma", 20, "Arsenal"), sm(4, "Delta", 30, "Liverpool"), sm(5, "Echo", 40, "Chelsea")] },
    ];
    const careers = (0, history_1.buildCareers)(squads);
    const qs = (0, career_path_1.generateCareerPath)(careers, { seed: "c1", count: 10, nowYear: NOW_YEAR, minSeasons: 2 });
    strict_1.default.ok(qs.length > 0, "produced questions");
    const byId = new Map(careers.map((c) => [c.playerId, c]));
    for (const q of qs) {
        const answer = byId.get(q.answerId);
        strict_1.default.ok(answer.clubs.length >= 2, "multi-club answers only");
        strict_1.default.ok(q.prompt.startsWith("My Premier League clubs, in order:"));
        // Clean gate: exactly one option whose sequence matches the prompt's
        const promptSeq = q.prompt.replace("My Premier League clubs, in order: ", "").replace(". Who am I?", "");
        let consistent = 0;
        for (const o of q.options) {
            const c = byId.get(o.id);
            if (c.clubs.map((x) => x.club).join(", ") === promptSeq)
                consistent++;
        }
        strict_1.default.equal(consistent, 1, "exactly one option fits the sequence");
    }
});
(0, node_test_1.test)("youth containment: U18 stints skipped; unknown-DOB careers never answers", () => {
    // Young: born 2000 → age 10-12 in 2010-2012 (youth stints at Fulham skipped),
    // then adult moves later. Ghost: no DOB → dobKnown false → never an answer.
    const young = (id, club, clubId) => ({ smId: id, name: "Young", clubId, club, dateOfBirth: "2000-06-01" });
    const squads = [
        { season: season(1, "2010/2011"), players: [young(1, "Fulham", 10), smNoDob(2, "Ghost", 20, "Arsenal"), sm(3, "Adult", 30, "Everton")] },
        { season: season(2, "2011/2012"), players: [young(1, "Fulham", 10), smNoDob(2, "Ghost", 40, "Chelsea"), sm(3, "Adult", 30, "Everton")] },
        { season: season(3, "2019/2020"), players: [young(1, "Leeds United", 50), smNoDob(2, "Ghost", 20, "Arsenal"), sm(3, "Adult", 50, "Leeds United")] },
        { season: season(4, "2020/2021"), players: [young(1, "Everton", 30), smNoDob(2, "Ghost", 20, "Arsenal"), sm(3, "Adult", 50, "Leeds United")] },
    ];
    const careers = (0, history_1.buildCareers)(squads);
    const youngC = careers.find((c) => c.playerId === 1);
    strict_1.default.equal((0, career_path_1.sequenceKey)(youngC), "Leeds United → Everton", "U18 Fulham stints skipped");
    strict_1.default.equal(youngC.dobKnown, true);
    const ghost = careers.find((c) => c.playerId === 2);
    strict_1.default.equal(ghost.dobKnown, false);
    const qs = (0, career_path_1.generateCareerPath)(careers, { seed: "y1", count: 10, nowYear: NOW_YEAR, minSeasons: 2 });
    for (const q of qs)
        strict_1.default.notEqual(q.answerId, 2, "unknown DOB never an answer");
});
(0, node_test_1.test)("career-path: single-club and duplicate-sequence players are never answers", () => {
    const squads = [
        { season: season(1, "2010/2011"), players: [sm(1, "Solo", 10, "Fulham"), sm(2, "Twin1", 20, "Arsenal"), sm(3, "Twin2", 20, "Arsenal"), sm(4, "Mover", 30, "Everton")] },
        { season: season(2, "2011/2012"), players: [sm(1, "Solo", 10, "Fulham"), sm(2, "Twin1", 40, "Chelsea"), sm(3, "Twin2", 40, "Chelsea"), sm(4, "Mover", 50, "West Ham United")] },
        { season: season(3, "2012/2013"), players: [sm(1, "Solo", 10, "Fulham"), sm(2, "Twin1", 40, "Chelsea"), sm(3, "Twin2", 40, "Chelsea"), sm(4, "Mover", 30, "Everton")] },
    ];
    const careers = (0, history_1.buildCareers)(squads);
    const qs = (0, career_path_1.generateCareerPath)(careers, { seed: "c2", count: 10, nowYear: NOW_YEAR, minSeasons: 2 });
    for (const q of qs) {
        strict_1.default.notEqual(q.answerId, 1, "single-club Solo never an answer");
        strict_1.default.ok(q.answerId !== 2 && q.answerId !== 3, "identical Twin sequences never answers");
        strict_1.default.equal(q.answerId, 4, "only Mover (unique multi-club) qualifies");
    }
});

"use strict";
/**
 * SportMonks enrichment + Who-am-I tests. Run: `bash scripts/gates/run-tests.sh`.
 * Focus: conservative matching (never wrong, allowed to be missing) and the
 * MCQ clean gate (exactly one option consistent with the clues).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const sportmonks_1 = require("./sportmonks");
const who_am_i_1 = require("./who-am-i");
const NOW = new Date("2026-07-08T00:00:00Z");
function P(over) {
    return {
        club: "MCI", clubId: 1, price: 5, ownership: 5, goals: 0, assists: 0,
        appearances: 10, minutes: 900, points: 50, form: 3, available: true, ...over,
    };
}
(0, node_test_1.test)("normalizeName strips accents/case; lastToken picks surname", () => {
    strict_1.default.equal((0, sportmonks_1.normalizeName)("Gündoğan"), "gundogan");
    strict_1.default.equal((0, sportmonks_1.normalizeName)("  Rúben   Dias "), "ruben dias");
    strict_1.default.equal((0, sportmonks_1.lastToken)("M.Salah"), "salah");
    strict_1.default.equal((0, sportmonks_1.lastToken)("Erling Haaland"), "haaland");
});
(0, node_test_1.test)("ageFrom computes whole years and rejects nonsense", () => {
    strict_1.default.equal((0, sportmonks_1.ageFrom)("2000-07-21", NOW), 25); // birthday in 13 days
    strict_1.default.equal((0, sportmonks_1.ageFrom)("2000-07-01", NOW), 26);
    strict_1.default.equal((0, sportmonks_1.ageFrom)("bogus", NOW), undefined);
    strict_1.default.equal((0, sportmonks_1.ageFrom)("1950-01-01", NOW), undefined); // out of range
});
(0, node_test_1.test)("matchClubs maps unambiguous names only", () => {
    const fpl = [
        { id: 1, name: "Man City" },
        { id: 2, name: "Spurs" },
    ];
    const sm = [
        { id: 9, name: "Manchester City" },
        { id: 6, name: "Tottenham Hotspur" },
        { id: 99, name: "Manchester United" },
    ];
    const map = (0, sportmonks_1.matchClubs)(fpl, sm);
    strict_1.default.equal(map.get(1), 9, "Man City → Manchester City (prefix tokens, beats United)");
    strict_1.default.equal(map.get(2), 6, "Spurs → Tottenham Hotspur (via alias expansion)");
    // Ambiguity stays unmapped: "City" alone ties Manchester City / Leicester City
    const amb = (0, sportmonks_1.matchClubs)([{ id: 3, name: "City FC" }], [
        { id: 9, name: "Manchester City" },
        { id: 31, name: "Leicester City" },
    ]);
    strict_1.default.equal(amb.has(3), false, "tied score → unmapped, never a wrong club");
});
(0, node_test_1.test)("buildEnrichment: unambiguous name+club matches; ambiguity skips", () => {
    const players = [
        P({ id: 10, name: "Haaland", position: "FWD", clubId: 1 }),
        P({ id: 11, name: "B.Silva", position: "MID", clubId: 1 }),
        P({ id: 12, name: "D.Silva", position: "MID", clubId: 1 }), // two Silvas at same club → both skipped
        P({ id: 13, name: "Saka", position: "MID", clubId: 2 }), // club unmapped → skipped
    ];
    const sm = [
        { smId: 900, name: "Erling Haaland", clubId: 9, club: "Manchester City", jersey: 9, dateOfBirth: "2000-07-21", nationality: "Norway" },
        { smId: 901, name: "Bernardo Silva", clubId: 9, club: "Manchester City", jersey: 20, dateOfBirth: "1994-08-10", nationality: "Portugal" },
    ];
    const clubMap = new Map([[1, 9]]);
    const enr = (0, sportmonks_1.buildEnrichment)(players, sm, clubMap, NOW);
    strict_1.default.deepEqual(enr.get(10), { nationality: "Norway", age: 25, jersey: 9, smId: 900 });
    strict_1.default.equal(enr.has(11), false, "two FPL Silvas at the club → ambiguous → skip");
    strict_1.default.equal(enr.has(12), false);
    strict_1.default.equal(enr.has(13), false, "unmapped club → skip");
    const enriched = (0, sportmonks_1.enrichPlayers)(players, enr);
    strict_1.default.equal(enriched[0].nationality, "Norway");
    strict_1.default.equal(players[0].nationality, undefined, "input untouched");
});
// --- Who-am-I ---------------------------------------------------------------
const POOL = [
    P({ id: 1, name: "Haaland", position: "FWD", ownership: 60, price: 14, goals: 20, nationality: "Norway", age: 25, jersey: 9 }),
    P({ id: 2, name: "Isak", position: "FWD", ownership: 30, price: 9, goals: 12, nationality: "Sweden", age: 26, jersey: 14 }),
    P({ id: 3, name: "Watkins", position: "FWD", ownership: 20, price: 9, goals: 11, nationality: "England", age: 30, jersey: 11 }),
    P({ id: 4, name: "Solanke", position: "FWD", ownership: 10, price: 7.5, goals: 8, nationality: "England", age: 28, jersey: 19 }),
    P({ id: 5, name: "Saka", position: "MID", ownership: 40, price: 10, goals: 10, nationality: "England", age: 24, jersey: 7 }),
    P({ id: 6, name: "Palmer", position: "MID", ownership: 45, price: 11, goals: 12, nationality: "England", age: 24, jersey: 10 }),
    P({ id: 7, name: "Rice", position: "MID", ownership: 15, price: 6.5, goals: 3, nationality: "England", age: 27, jersey: 41 }),
    P({ id: 8, name: "MysteryMid", position: "MID", ownership: 2, price: 4.5, goals: 1 }), // unenriched
    P({ id: 9, name: "Raya", position: "GK", ownership: 12, price: 5.6, goals: 0, nationality: "Spain", age: 30, jersey: 22 }),
];
const byId = new Map(POOL.map((p) => [p.id, p]));
(0, node_test_1.test)("who-am-i: answers are fully enriched; unenriched can't be answers", () => {
    strict_1.default.equal((0, who_am_i_1.isAnswerEligible)(byId.get(1)), true);
    strict_1.default.equal((0, who_am_i_1.isAnswerEligible)(byId.get(8)), false);
    const qs = (0, who_am_i_1.generateWhoAmI)(POOL, { seed: "w1", count: 20 });
    for (const q of qs)
        strict_1.default.notEqual(q.answerId, 8);
});
(0, node_test_1.test)("who-am-i: clean gate — exactly one option consistent with the clues", () => {
    const qs = (0, who_am_i_1.generateWhoAmI)(POOL, { seed: "w2", count: 20 });
    strict_1.default.ok(qs.length > 0, "produced questions");
    for (const q of qs) {
        const answer = byId.get(q.answerId);
        const clues = (0, who_am_i_1.buildClues)(answer, 3);
        let consistent = 0;
        for (const o of q.options) {
            const p = byId.get(o.id);
            if (!(0, who_am_i_1.isExcluded)(p, clues))
                consistent++;
        }
        strict_1.default.equal(consistent, 1, `${answer.name}: exactly one consistent option`);
        strict_1.default.equal(q.options.length, 4);
        // distractors share the answer's position (clue 1 must not solve it)
        for (const o of q.options)
            strict_1.default.equal(byId.get(o.id).position, answer.position);
        strict_1.default.ok(q.prompt.startsWith("I'm a "), "first-person drip clues");
        strict_1.default.ok(q.difficulty >= 0 && q.difficulty <= 100);
    }
});
(0, node_test_1.test)("who-am-i: an unexcludable clone blocks the question (precision > coverage)", () => {
    // Clone of Haaland with unknown jersey — position/age/nationality all match,
    // jersey unknown can't exclude, same goals: NOT excludable → any question with
    // Haaland as answer must not use the clone as a distractor.
    const clone = P({ id: 99, name: "HaalandClone", position: "FWD", goals: 20, nationality: "Norway", age: 25 });
    const pool = [...POOL, clone];
    const cloneById = new Map(pool.map((p) => [p.id, p]));
    const qs = (0, who_am_i_1.generateWhoAmI)(pool, { seed: "w3", count: 30 });
    for (const q of qs) {
        const answer = cloneById.get(q.answerId);
        const clues = (0, who_am_i_1.buildClues)(answer, 3);
        for (const o of q.options) {
            if (o.id === q.answerId)
                continue;
            strict_1.default.ok((0, who_am_i_1.isExcluded)(cloneById.get(o.id), clues), "every distractor excludable");
        }
    }
});
(0, node_test_1.test)("who-am-i is deterministic per seed", () => {
    const a = (0, who_am_i_1.generateWhoAmI)(POOL, { seed: "same", count: 10 });
    const b = (0, who_am_i_1.generateWhoAmI)(POOL, { seed: "same", count: 10 });
    strict_1.default.deepEqual(a, b);
});

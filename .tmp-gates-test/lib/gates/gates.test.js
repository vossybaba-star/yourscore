"use strict";
/**
 * Gate generator tests. Run: `bash scripts/gates/run-tests.sh`.
 *
 * Verifies the two things that matter: the generated questions are CORRECT (the
 * answer really is the higher stat) and CLEAN (no ties / sub-margin / noise), plus
 * that the pipeline is deterministic and the form filter excludes non-starters.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const types_1 = require("./types");
const fame_1 = require("./fame");
const higher_lower_1 = require("./higher-lower");
const fpl_1 = require("./fpl");
function P(over) {
    return {
        club: "TST",
        clubId: 1,
        price: 5,
        ownership: 5,
        goals: 0,
        assists: 0,
        appearances: 10,
        minutes: 900,
        points: 50,
        form: 3,
        available: true,
        ...over,
    };
}
const FIXTURE = [
    P({ id: 1, name: "Haaland", position: "FWD", price: 14, ownership: 50, goals: 20, minutes: 1800, points: 150, form: 8 }),
    P({ id: 2, name: "Salah", position: "FWD", price: 13, ownership: 45, goals: 18, minutes: 1750, points: 145, form: 7 }),
    P({ id: 3, name: "Palmer", position: "MID", price: 11, ownership: 35, goals: 12, minutes: 1700, points: 130, form: 6.5 }),
    P({ id: 4, name: "Saka", position: "MID", price: 10, ownership: 30, goals: 10, minutes: 1600, points: 120, form: 6 }),
    P({ id: 5, name: "Watkins", position: "FWD", price: 9, ownership: 20, goals: 11, minutes: 1650, points: 110, form: 5.5 }),
    P({ id: 6, name: "Mitoma", position: "MID", price: 6.5, ownership: 8, goals: 6, minutes: 1400, points: 80, form: 4 }),
    P({ id: 7, name: "ObscureDef", position: "DEF", price: 4.5, ownership: 1, goals: 1, minutes: 500, points: 40, form: 2 }),
    // Excluded from This-season form: injured (not available)
    P({ id: 8, name: "InjuredFwd", position: "FWD", price: 7, ownership: 5, goals: 5, minutes: 900, points: 60, form: 0, available: false }),
    // Excluded from This-season form: barely plays
    P({ id: 9, name: "BenchMid", position: "MID", price: 4.5, ownership: 0.5, goals: 0, minutes: 100, points: 15, form: 0.5 }),
];
const byId = new Map(FIXTURE.map((p) => [p.id, p]));
(0, node_test_1.test)("fame: famous > obscure, all within 0–100", () => {
    const fame = (0, fame_1.buildFameIndex)(FIXTURE);
    strict_1.default.ok(fame.fame(1) > fame.fame(7), "Haaland more famous than ObscureDef");
    strict_1.default.ok(fame.fame(1) > fame.fame(9), "Haaland more famous than BenchMid");
    for (const p of FIXTURE) {
        const f = fame.fame(p.id);
        strict_1.default.ok(f >= 0 && f <= 100, `${p.name} fame in range: ${f}`);
    }
});
(0, node_test_1.test)("closeness + difficulty behave", () => {
    strict_1.default.equal((0, fame_1.closeness)(10, 10), 100);
    strict_1.default.equal((0, fame_1.closeness)(10, 0), 0);
    strict_1.default.ok((0, fame_1.closeness)(20, 18) > (0, fame_1.closeness)(20, 5));
    const d = (0, fame_1.comparisonDifficulty)(10, 10, 90); // obscure + close = hard
    strict_1.default.ok(d > (0, fame_1.comparisonDifficulty)(90, 90, 10)); // famous + far = easy
    strict_1.default.ok(d >= 0 && d <= 100);
});
(0, node_test_1.test)("validator rejects ties, sub-margin and noise; accepts clear", () => {
    strict_1.default.equal((0, higher_lower_1.isValidComparison)(10, 10, 0.15, 2), false, "tie");
    strict_1.default.equal((0, higher_lower_1.isValidComparison)(10, 9, 0.15, 2), false, "sub-margin (10% < 15%)");
    strict_1.default.equal((0, higher_lower_1.isValidComparison)(1, 0, 0.15, 2), false, "below min-top noise");
    strict_1.default.equal((0, higher_lower_1.isValidComparison)(20, 10, 0.15, 2), true, "clear");
    strict_1.default.equal((0, higher_lower_1.isValidComparison)(NaN, 10, 0.15, 2), false, "NaN");
});
(0, node_test_1.test)("Higher/Lower: every question's answer is the higher stat", () => {
    for (const stat of ["price", "goals", "points"]) {
        const qs = (0, higher_lower_1.generateHigherLower)(FIXTURE, { stat, seed: "s1", count: 20 });
        strict_1.default.ok(qs.length > 0, `produced questions for ${stat}`);
        for (const q of qs) {
            strict_1.default.equal(q.options.length, 2);
            strict_1.default.equal(q.format, "higher-lower");
            const [o1, o2] = q.options;
            const p1 = byId.get(o1.id);
            const p2 = byId.get(o2.id);
            const higher = (0, types_1.statValue)(p1, stat) > (0, types_1.statValue)(p2, stat) ? p1 : p2;
            strict_1.default.equal(q.answerId, higher.id, `${stat}: ${p1.name} vs ${p2.name}`);
            strict_1.default.ok(q.difficulty >= 0 && q.difficulty <= 100);
            strict_1.default.ok(q.answerId === o1.id || q.answerId === o2.id, "answer is one of the options");
        }
    }
});
(0, node_test_1.test)("Higher/Lower is deterministic per seed", () => {
    const a = (0, higher_lower_1.generateHigherLower)(FIXTURE, { stat: "goals", seed: "same", count: 15 });
    const b = (0, higher_lower_1.generateHigherLower)(FIXTURE, { stat: "goals", seed: "same", count: 15 });
    strict_1.default.deepEqual(a, b);
    const c = (0, higher_lower_1.generateHigherLower)(FIXTURE, { stat: "goals", seed: "different", count: 15 });
    strict_1.default.notDeepEqual(a, c);
});
(0, node_test_1.test)("This-season form excludes injured + non-starters", () => {
    const qs = (0, higher_lower_1.generateThisSeasonForm)(FIXTURE, { seed: "f1", count: 30, stat: "points" });
    strict_1.default.ok(qs.length > 0);
    for (const q of qs) {
        strict_1.default.equal(q.format, "this-season-form");
        for (const o of q.options) {
            const p = byId.get(o.id);
            strict_1.default.ok(p.available, `${p.name} available`);
            strict_1.default.ok(p.minutes >= higher_lower_1.REGULAR_STARTER_MINUTES, `${p.name} is a regular starter`);
            strict_1.default.notEqual(o.id, 8, "InjuredFwd excluded");
            strict_1.default.notEqual(o.id, 9, "BenchMid excluded");
        }
    }
});
(0, node_test_1.test)("FPL adapter maps bootstrap shape correctly", () => {
    const boot = {
        teams: [{ id: 1, short_name: "ARS" }],
        elements: [
            {
                id: 100, web_name: "Saka", element_type: 3, team: 1, now_cost: 105,
                selected_by_percent: "30.5", goals_scored: 10, assists: 8, minutes: 1600,
                starts: 18, total_points: 120, form: "6.2", status: "a", code: 223340,
            },
        ],
    };
    const [p] = (0, fpl_1.fplToPlayers)(boot);
    strict_1.default.equal(p.name, "Saka");
    strict_1.default.equal(p.position, "MID");
    strict_1.default.equal(p.club, "ARS");
    strict_1.default.equal(p.price, 10.5);
    strict_1.default.equal(p.ownership, 30.5);
    strict_1.default.equal(p.appearances, 18);
    strict_1.default.equal(p.available, true);
});

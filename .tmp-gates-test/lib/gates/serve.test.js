"use strict";
/**
 * Serving-layer tests: per-user variation, client stripping, grading, budget.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const serve_1 = require("./serve");
/** A synthetic pool: `n` questions per position, unique answers/prompts. */
function pool(perPos) {
    const out = [];
    let id = 1;
    for (const pos of ["GK", "DEF", "MID", "FWD"]) {
        for (let i = 0; i < perPos; i++) {
            const a = id++;
            const b = id++;
            out.push({
                format: "higher-lower",
                stat: "goals",
                prompt: `Q${pos}${i}: who has more goals?`,
                options: [
                    { id: a, label: `P${a}` },
                    { id: b, label: `P${b}` },
                ],
                answerId: a,
                difficulty: (i * 17) % 100,
                positions: [pos],
            });
        }
    }
    return out;
}
(0, node_test_1.test)("formationSlots parses shapes", () => {
    strict_1.default.deepEqual((0, serve_1.formationSlots)("4-3-3").join(","), "GK,DEF,DEF,DEF,DEF,MID,MID,MID,FWD,FWD,FWD");
    strict_1.default.equal((0, serve_1.formationSlots)("3-5-2").filter((p) => p === "MID").length, 5);
    strict_1.default.equal((0, serve_1.formationSlots)("junk").length, 11); // falls back to 4-3-3
});
(0, node_test_1.test)("buildRound: 11 position-matched questions, no reused answers/prompts", () => {
    const round = (0, serve_1.buildRound)(pool(20), { gameweek: "gw1", userId: "alice" });
    strict_1.default.equal(round.questions.length, 11);
    const answers = new Set(round.questions.map((q) => q.answerId));
    strict_1.default.equal(answers.size, 11, "no answer player repeats");
    const prompts = new Set(round.questions.map((q) => q.prompt));
    strict_1.default.equal(prompts.size, 11, "no prompt repeats");
    // Position coverage matches the formation
    const served = (0, serve_1.clientView)(round);
    const posCount = new Map();
    for (const s of served)
        posCount.set(s.position, (posCount.get(s.position) ?? 0) + 1);
    strict_1.default.equal(posCount.get("GK"), 1);
    strict_1.default.equal(posCount.get("DEF"), 4);
    strict_1.default.equal(posCount.get("MID"), 3);
    strict_1.default.equal(posCount.get("FWD"), 3);
});
(0, node_test_1.test)("per-user variation: different users get different rounds; same user stable", () => {
    const p = pool(30);
    const a1 = (0, serve_1.buildRound)(p, { gameweek: "gw1", userId: "alice" });
    const a2 = (0, serve_1.buildRound)(p, { gameweek: "gw1", userId: "alice" });
    const b = (0, serve_1.buildRound)(p, { gameweek: "gw1", userId: "bob" });
    const gw2 = (0, serve_1.buildRound)(p, { gameweek: "gw2", userId: "alice" });
    strict_1.default.deepEqual(a1.questions, a2.questions, "same user+gw → same round (resume-safe)");
    strict_1.default.notDeepEqual(a1.questions, b.questions, "different user → different round");
    strict_1.default.notDeepEqual(a1.questions, gw2.questions, "different gameweek → different round");
});
(0, node_test_1.test)("clientView strips answers and meta", () => {
    const round = (0, serve_1.buildRound)(pool(20), { gameweek: "gw1", userId: "alice" });
    const served = (0, serve_1.clientView)(round);
    for (const s of served) {
        strict_1.default.equal("answerId" in s, false);
        strict_1.default.equal("meta" in s, false);
        strict_1.default.equal("difficulty" in s, false, "difficulty hidden too (no cherry-picking)");
        strict_1.default.ok(s.options.length >= 2);
    }
});
(0, node_test_1.test)("grade: correct/incorrect/invalid handled server-side", () => {
    const round = (0, serve_1.buildRound)(pool(20), { gameweek: "gw1", userId: "alice" });
    const q = round.questions[0];
    const wrongOption = q.options.find((o) => o.id !== q.answerId);
    strict_1.default.equal((0, serve_1.grade)(round, 0, q.answerId)?.correct, true);
    strict_1.default.equal((0, serve_1.grade)(round, 0, wrongOption.id)?.correct, false);
    strict_1.default.equal((0, serve_1.grade)(round, 0, 999999), null, "not an offered option");
    strict_1.default.equal((0, serve_1.grade)(round, 99, q.answerId), null, "bad index");
});
(0, node_test_1.test)("budget: harder correct answers pay more; wrong pays nothing", () => {
    strict_1.default.equal((0, serve_1.budgetWeight)(0), 1);
    strict_1.default.equal((0, serve_1.budgetWeight)(100), 2);
    const budget = (0, serve_1.roundBudget)([
        { correct: true, difficulty: 0 }, // 5.0
        { correct: true, difficulty: 100 }, // 10.0
        { correct: false, difficulty: 100 }, // 0
    ], 5);
    strict_1.default.equal(budget, 15);
});

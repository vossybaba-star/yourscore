"use strict";
/**
 * Serving layer — turns the generated pool into a per-user round.
 *
 * Anti-cheat by construction:
 * - Every user gets a DIFFERENT seeded subset per gameweek (seed = gw:user), so
 *   there's no shared answer key to post in the group chat.
 * - The client only ever sees ServedQuestion (answerId stripped); grading is
 *   server-side against the full round.
 *
 * The layer is pure (no DB, no Date) — the API route owns persistence. Budget
 * weighting: a correct answer pays base × (1 + difficulty/100), so harder
 * questions earn more — but the user never CHOOSES difficulty (that invites
 * cheating); the round just mixes easy → hard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formationSlots = formationSlots;
exports.buildRound = buildRound;
exports.clientView = clientView;
exports.grade = grade;
exports.budgetWeight = budgetWeight;
exports.roundBudget = roundBudget;
const rng_1 = require("./rng");
/** Formation slot list, e.g. 4-3-3 → [GK, DEF×4, MID×3, FWD×3]. */
function formationSlots(formation) {
    const m = formation.match(/^(\d)-(\d)-(\d)$/);
    const def = m ? parseInt(m[1], 10) : 4;
    const mid = m ? parseInt(m[2], 10) : 3;
    const fwd = m ? parseInt(m[3], 10) : 3;
    const out = ["GK"];
    for (let i = 0; i < def; i++)
        out.push("DEF");
    for (let i = 0; i < mid; i++)
        out.push("MID");
    for (let i = 0; i < fwd; i++)
        out.push("FWD");
    return out;
}
/**
 * Build a per-user round: one question per slot, position-matched, no player
 * reused as an answer across the round, difficulty mixed easy→hard within each
 * position so early picks warm the user up.
 */
function buildRound(pool, opts) {
    const positions = formationSlots(opts.formation ?? "4-3-3");
    const seed = `${opts.gameweek}:${opts.userId}`;
    const rand = (0, rng_1.seededRng)(seed);
    // Group + shuffle the pool per position (a question tagged with several
    // positions is eligible for each).
    const byPos = new Map();
    for (const pos of ["GK", "DEF", "MID", "FWD"]) {
        const qs = pool.filter((q) => q.positions.includes(pos));
        byPos.set(pos, (0, rng_1.shuffle)(qs, rand));
    }
    const usedAnswers = new Set();
    const usedPrompts = new Set();
    const picked = [];
    const slotCount = new Map();
    for (const pos of positions)
        slotCount.set(pos, (slotCount.get(pos) ?? 0) + 1);
    for (const [pos, n] of Array.from(slotCount.entries())) {
        const eligible = byPos.get(pos) ?? [];
        const chosen = [];
        for (const q of eligible) {
            if (chosen.length >= n)
                break;
            if (usedAnswers.has(q.answerId) || usedPrompts.has(q.prompt))
                continue;
            chosen.push(q);
            usedAnswers.add(q.answerId);
            usedPrompts.add(q.prompt);
        }
        // Within a position, serve easiest first (warm-up curve).
        chosen.sort((a, b) => a.difficulty - b.difficulty);
        for (const q of chosen)
            picked.push({ q, pos });
    }
    // Order the round by slot order (GK → DEF → MID → FWD), which the position
    // grouping above already yields; flatten to the final list.
    return { seed, questions: picked.map((p) => p.q), positions };
}
/** Client-safe view of a round — answers + meta stripped. */
function clientView(round) {
    return round.questions.map((q, idx) => ({
        idx,
        format: q.format,
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
        position: round.positions[idx] ?? q.positions[0] ?? "MID",
    }));
}
/** Grade one answer server-side. */
function grade(round, idx, optionId) {
    const q = round.questions[idx];
    if (!q)
        return null;
    if (!q.options.some((o) => o.id === optionId))
        return null; // not an offered option
    return { correct: optionId === q.answerId, difficulty: q.difficulty };
}
/** Budget weight for a correct answer: 1.0 (easiest) → 2.0 (hardest). */
function budgetWeight(difficulty) {
    const d = Math.max(0, Math.min(100, difficulty));
    return 1 + d / 100;
}
/**
 * Total budget for a set of graded answers. `base` is the per-correct budget
 * unit (the game layer's tuning dial); wrong answers pay nothing.
 */
function roundBudget(results, base) {
    let total = 0;
    for (const r of results)
        if (r.correct)
            total += base * budgetWeight(r.difficulty);
    return Math.round(total * 10) / 10;
}

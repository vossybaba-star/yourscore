"use strict";
/**
 * Classic-trivia generator — era questions produced and VERIFIED from the
 * historical dataset (no authoring): champions ("Who won the league in
 * 2013/14?") and Golden Boots ("Who was the top scorer in 2013/14?").
 *
 * Clean by construction: the answer comes straight off the season's data, the
 * distractors come from the SAME season (runners-up / next scorers), so every
 * option is plausible but provably wrong. Ties are rejected, never fudged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.eraDifficulty = eraDifficulty;
exports.championQuestion = championQuestion;
exports.topScorerQuestion = topScorerQuestion;
exports.generateTrivia = generateTrivia;
const history_1 = require("./history");
const rng_1 = require("./rng");
/** Era difficulty: this season = ~20, `hardYearsAgo`+ = ~90. */
function eraDifficulty(startYear, nowYear, hardYearsAgo = 15) {
    const ago = Math.max(0, nowYear - startYear);
    const d = 20 + (ago / hardYearsAgo) * 70;
    return Math.max(0, Math.min(100, Math.round(d)));
}
/** "Who won the Premier League in 2013/14?" — answer = 1st, distractors = 2nd–4th. */
function championQuestion(h, opts) {
    const top4 = h.standings.filter((s) => s.position >= 1 && s.position <= 4);
    if (top4.length < 4)
        return null;
    const [first, ...rest] = top4;
    // Reject a tied title on points (impossible in practice — goal difference
    // decides — but the data must prove a unique winner row).
    if (h.standings.filter((s) => s.position === 1).length !== 1)
        return null;
    const rand = (0, rng_1.seededRng)(`${opts.seed}:champion:${h.season.id}`);
    const options = (0, rng_1.shuffle)([
        { id: first.teamId, label: first.team },
        ...rest.map((t) => ({ id: t.teamId, label: t.team })),
    ], rand);
    return {
        format: "classic-trivia",
        prompt: `Who won the Premier League in ${(0, history_1.shortSeasonName)(h.season.name)}?`,
        options,
        answerId: first.teamId,
        difficulty: eraDifficulty(h.season.startYear, opts.nowYear, opts.hardYearsAgo),
        positions: ["GK", "DEF", "MID", "FWD"], // club knowledge — any slot
        meta: { season: h.season.name, points: first.points },
    };
}
/** "Who was the PL top scorer in 2013/14?" — answer = #1, distractors = #2–4. */
function topScorerQuestion(h, opts) {
    const list = h.topScorers;
    if (list.length < 4)
        return null;
    const [first, second, third, fourth] = list;
    // Clean gate: reject a shared Golden Boot (tied top total) — an MCQ can't
    // have two right answers.
    if (second.goals === first.goals)
        return null;
    const rand = (0, rng_1.seededRng)(`${opts.seed}:topscorer:${h.season.id}`);
    const options = (0, rng_1.shuffle)([first, second, third, fourth].map((s) => ({ id: s.playerId, label: s.name })), rand);
    return {
        format: "classic-trivia",
        prompt: `Who was the Premier League's top scorer in ${(0, history_1.shortSeasonName)(h.season.name)}?`,
        options,
        answerId: first.playerId,
        // Scorer recall is a notch harder than champions: +10.
        difficulty: Math.min(100, eraDifficulty(h.season.startYear, opts.nowYear, opts.hardYearsAgo) + 10),
        positions: ["MID", "FWD"], // striker knowledge — attacking slots
        meta: { season: h.season.name, goals: first.goals, answer: first.name },
    };
}
/** All trivia for a set of seasons (order deterministic by season). */
function generateTrivia(history, opts) {
    const out = [];
    for (const h of history) {
        const c = championQuestion(h, opts);
        if (c)
            out.push(c);
        const t = topScorerQuestion(h, opts);
        if (t)
            out.push(t);
    }
    return out;
}

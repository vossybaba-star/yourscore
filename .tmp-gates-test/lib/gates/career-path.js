"use strict";
/**
 * Career-path generator — "where did they come from, where did they go":
 * name the player from their ordered run of Premier League clubs, built from
 * the historical squads (buildCareers). First person, like Who-am-I:
 *
 *   "My Premier League clubs, in order: Southampton, Liverpool. Who am I?"
 *
 * Framed explicitly as *Premier League* career — foreign spells are invisible
 * on this data by design, and the wording makes that honest.
 *
 * Clean gate (MCQ): the answer's club sequence must be UNIQUE among all known
 * careers, and every distractor's own sequence must differ — so exactly one
 * option fits the prompt. Distractors are picked to OVERLAP the answer's clubs
 * (plausible teammates-in-space), never to share the full sequence.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sequenceKey = sequenceKey;
exports.generateCareerPath = generateCareerPath;
const rng_1 = require("./rng");
/** Canonical key for a club sequence. */
function sequenceKey(c) {
    return c.clubs.map((x) => x.club).join(" → ");
}
/** Difficulty: era (older start = harder) + shortness (fewer clubs = fewer clues). */
function careerDifficulty(c, nowYear) {
    const ago = Math.max(0, nowYear - c.firstYear);
    const era = Math.min(70, (ago / 20) * 70);
    const brevity = c.clubs.length <= 2 ? 20 : c.clubs.length === 3 ? 10 : 0;
    return Math.max(0, Math.min(100, Math.round(20 + era * 0.7 + brevity)));
}
function generateCareerPath(careers, opts) {
    const count = opts.count ?? 30;
    const minClubs = opts.minClubs ?? 2;
    const minSeasons = opts.minSeasons ?? 4;
    const maxAttempts = opts.attempts ?? count * 40;
    const rand = (0, rng_1.seededRng)(`${opts.seed}:career-path`);
    // Eligible answers: multi-club, established careers with a UNIQUE sequence.
    // dobKnown required — otherwise the club list may hide un-filterable youth
    // spells (founder: no "clubs he was at aged 16" questions).
    const seqCount = new Map();
    for (const c of careers) {
        const k = sequenceKey(c);
        seqCount.set(k, (seqCount.get(k) ?? 0) + 1);
    }
    const eligible = careers.filter((c) => c.dobKnown &&
        c.clubs.length >= minClubs &&
        c.seasons >= minSeasons &&
        seqCount.get(sequenceKey(c)) === 1);
    const out = [];
    const used = new Set();
    let attempts = 0;
    while (out.length < count && attempts < maxAttempts) {
        attempts++;
        const answer = eligible[Math.floor(rand() * eligible.length)];
        if (!answer || used.has(answer.playerId))
            continue;
        const answerKey = sequenceKey(answer);
        const answerClubs = new Set(answer.clubs.map((x) => x.club));
        // Distractors: different sequence (clean gate), preferring careers that
        // OVERLAP the answer's clubs so wrong options feel plausible.
        const pool = careers.filter((c) => c.playerId !== answer.playerId && sequenceKey(c) !== answerKey && c.seasons >= 2);
        if (pool.length < 3)
            continue;
        const scored = pool
            .map((c) => {
            let overlap = 0;
            for (const x of c.clubs)
                if (answerClubs.has(x.club))
                    overlap++;
            return { c, score: overlap * 10 + rand() * 8 };
        })
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
        const distractors = (0, rng_1.shuffle)(scored.map((s) => s.c), rand).slice(0, 3);
        if (distractors.length < 3)
            continue;
        used.add(answer.playerId);
        const options = (0, rng_1.shuffle)([answer, ...distractors].map((c) => ({ id: c.playerId, label: c.name })), rand);
        out.push({
            format: "career-path",
            prompt: `My Premier League clubs, in order: ${answer.clubs
                .map((x) => x.club)
                .join(", ")}. Who am I?`,
            options,
            answerId: answer.playerId,
            difficulty: careerDifficulty(answer, opts.nowYear),
            positions: ["GK", "DEF", "MID", "FWD"], // career knowledge — any slot
            meta: {
                answer: answer.name,
                sequence: answerKey,
                firstYear: answer.firstYear,
                ...(answer.photoUrl ? { photo: answer.photoUrl } : {}),
            },
        });
    }
    return out;
}

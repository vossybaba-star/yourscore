"use strict";
/**
 * Who-am-I generator — the first-person drip-clue format ("I'm 25. I'm
 * Norwegian. I wear number 9. Who am I?"), served as a 4-option MCQ.
 *
 * Clean rule for an MCQ: EXACTLY ONE option may be consistent with the clues.
 * Every distractor must be EXCLUDED by at least one clue whose attribute is
 * KNOWN for that distractor (an unknown attribute can't exclude, so it doesn't
 * count). Answers require full enrichment (nationality + age + jersey) so the
 * clue set is always complete. Precision over coverage: thin data → fewer
 * questions, never dirty ones.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClues = buildClues;
exports.isExcluded = isExcluded;
exports.isAnswerEligible = isAnswerEligible;
exports.generateWhoAmI = generateWhoAmI;
const fame_1 = require("./fame");
const rng_1 = require("./rng");
const POSITION_WORD = {
    GK: "goalkeeper",
    DEF: "defender",
    MID: "midfielder",
    FWD: "forward",
};
/** Build the drip-clue list for an answer. Club is deliberately never a clue —
 *  club + jersey would be a giveaway; the tension is triangulating without it. */
function buildClues(answer, minGoalsClue, seasonLabel) {
    const clues = [
        {
            line: `I'm a ${POSITION_WORD[answer.position]}.`,
            excludes: (p) => p.position !== answer.position,
        },
        {
            line: `I'm ${answer.age}.`,
            excludes: (p) => p.age !== undefined && p.age !== answer.age,
        },
        {
            line: `I'm from ${answer.nationality}.`,
            excludes: (p) => p.nationality !== undefined && p.nationality !== answer.nationality,
        },
        {
            line: `I wear number ${answer.jersey}.`,
            excludes: (p) => p.jersey !== undefined && p.jersey !== answer.jersey,
        },
    ];
    if (answer.goals >= minGoalsClue) {
        clues.push({
            line: seasonLabel
                ? `I scored ${answer.goals} in the ${seasonLabel} season.`
                : `I've scored ${answer.goals} this season.`,
            // goals is a base FPL stat — always known
            excludes: (p) => p.goals !== answer.goals,
        });
    }
    return clues;
}
/** Can `p` be ruled out by at least one clue (via a KNOWN differing attribute)? */
function isExcluded(p, clues) {
    return clues.some((c) => c.excludes(p));
}
/** Fully enriched = eligible to be a Who-am-I answer. Strict typeof checks so
 *  API nulls can never leak into a clue line ("I wear number null"). */
function isAnswerEligible(p) {
    return (typeof p.nationality === "string" &&
        p.nationality.length > 0 &&
        typeof p.age === "number" &&
        typeof p.jersey === "number" &&
        p.name.length > 1);
}
function difficultyFor(answer, distractors, fame) {
    // Obscure answers are harder; distractors from the same nationality or same
    // age band tighten the triangulation and add a little difficulty.
    const obscurity = 100 - fame.fame(answer.id);
    let tight = 0;
    for (const d of distractors) {
        if (d.nationality !== undefined && d.nationality === answer.nationality)
            tight += 8;
        if (d.age !== undefined && answer.age !== undefined && Math.abs(d.age - answer.age) <= 2)
            tight += 4;
    }
    return Math.max(0, Math.min(100, Math.round(0.8 * obscurity + tight)));
}
/** Generate Who-am-I questions from an enriched pool. */
function generateWhoAmI(players, opts) {
    const count = opts.count ?? 30;
    const minGoalsClue = opts.minGoalsClue ?? 3;
    const maxAttempts = opts.attempts ?? count * 40;
    const rand = (0, rng_1.seededRng)(`${opts.seed}:who-am-i`);
    const fame = (0, fame_1.buildFameIndex)(players);
    const eligible = players.filter(isAnswerEligible);
    const out = [];
    const used = new Set();
    let attempts = 0;
    while (out.length < count && attempts < maxAttempts) {
        attempts++;
        const answer = eligible[Math.floor(rand() * eligible.length)];
        if (!answer || used.has(answer.id))
            continue;
        const clues = buildClues(answer, minGoalsClue, opts.seasonLabel);
        // Distractors: same position (so the position clue doesn't trivially solve
        // it), excluded by ≥1 KNOWN clue, and not the answer.
        const samePos = players.filter((p) => p.id !== answer.id && p.position === answer.position && isExcluded(p, clues));
        if (samePos.length < 3)
            continue;
        // Prefer distractors of comparable fame to the answer (plausibility).
        const ranked = samePos
            .map((p) => ({ p, gap: Math.abs(fame.fame(p.id) - fame.fame(answer.id)) + rand() * 20 }))
            .sort((a, b) => a.gap - b.gap)
            .slice(0, 8);
        const distractors = (0, rng_1.shuffle)(ranked.map((r) => r.p), rand).slice(0, 3);
        if (distractors.length < 3)
            continue;
        // CLEAN GATE: exactly one option (the answer) consistent with all clues.
        if (distractors.some((d) => !isExcluded(d, clues)))
            continue;
        used.add(answer.id);
        const options = (0, rng_1.shuffle)([answer, ...distractors], rand).map((p) => ({
            id: p.id,
            label: p.name,
        }));
        // The prompt carries only the TEXT clues (position, age, goals). Nationality
        // and shirt number are rendered as visuals (flag + shirt graphic) from meta,
        // so they're stripped from the text to avoid duplication. All clues still
        // gate validity via `clues` above — this only changes presentation.
        const promptLines = [`I'm a ${POSITION_WORD[answer.position]}.`, `I'm ${answer.age}.`];
        if (answer.goals >= minGoalsClue) {
            promptLines.push(opts.seasonLabel
                ? `I scored ${answer.goals} in the ${opts.seasonLabel} season.`
                : `I've scored ${answer.goals} this season.`);
        }
        out.push({
            format: "who-am-i",
            prompt: promptLines.join("\n"),
            options,
            answerId: answer.id,
            difficulty: difficultyFor(answer, distractors, fame),
            positions: [answer.position],
            meta: {
                answer: answer.name,
                club: answer.club,
                nationality: answer.nationality ?? "",
                jersey: typeof answer.jersey === "number" ? answer.jersey : -1,
                ...(answer.flagUrl ? { flag: answer.flagUrl } : {}),
                ...(answer.photoUrl ? { photo: answer.photoUrl } : {}),
            },
        });
    }
    return out;
}

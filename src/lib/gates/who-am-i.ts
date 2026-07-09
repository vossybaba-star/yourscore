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

import type { GateQuestion, Player, Position } from "./types";
import { buildFameIndex, type FameIndex } from "./fame";
import { seededRng, shuffle } from "./rng";

export interface WhoAmIOpts {
  seed: string;
  count?: number; // default 30
  attempts?: number; // default count * 40
  /** Minimum season goals before the goals clue is used. */
  minGoalsClue?: number; // default 3
  /** The season the goals clue refers to, e.g. "2025/26" — time-relative
   *  phrases must be labelled (founder rule). */
  seasonLabel?: string;
}

const POSITION_WORD: Record<Position, string> = {
  GK: "goalkeeper",
  DEF: "defender",
  MID: "midfielder",
  FWD: "forward",
};

/** A single clue: display line + does it exclude a given player? */
interface Clue {
  line: string;
  /** true = `p` is excluded by this clue (KNOWN attribute, different value). */
  excludes(p: Player): boolean;
}

/** Build the drip-clue list for an answer. Club is deliberately never a clue —
 *  club + jersey would be a giveaway; the tension is triangulating without it. */
export function buildClues(answer: Player, minGoalsClue: number, seasonLabel?: string): Clue[] {
  const clues: Clue[] = [
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
export function isExcluded(p: Player, clues: readonly Clue[]): boolean {
  return clues.some((c) => c.excludes(p));
}

/** Fully enriched = eligible to be a Who-am-I answer. Strict typeof checks so
 *  API nulls can never leak into a clue line ("I wear number null"). */
export function isAnswerEligible(p: Player): boolean {
  return (
    typeof p.nationality === "string" &&
    p.nationality.length > 0 &&
    typeof p.age === "number" &&
    typeof p.jersey === "number" &&
    p.name.length > 1
  );
}

function difficultyFor(answer: Player, distractors: readonly Player[], fame: FameIndex): number {
  // Obscure answers are harder; distractors from the same nationality or same
  // age band tighten the triangulation and add a little difficulty.
  const obscurity = 100 - fame.fame(answer.id);
  let tight = 0;
  for (const d of distractors) {
    if (d.nationality !== undefined && d.nationality === answer.nationality) tight += 8;
    if (d.age !== undefined && answer.age !== undefined && Math.abs(d.age - answer.age) <= 2) tight += 4;
  }
  return Math.max(0, Math.min(100, Math.round(0.8 * obscurity + tight)));
}

/** Generate Who-am-I questions from an enriched pool. */
export function generateWhoAmI(players: readonly Player[], opts: WhoAmIOpts): GateQuestion[] {
  const count = opts.count ?? 30;
  const minGoalsClue = opts.minGoalsClue ?? 3;
  const maxAttempts = opts.attempts ?? count * 40;
  const rand = seededRng(`${opts.seed}:who-am-i`);
  const fame = buildFameIndex(players);

  const eligible = players.filter(isAnswerEligible);
  const out: GateQuestion[] = [];
  const used = new Set<number>();
  let attempts = 0;

  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    const answer = eligible[Math.floor(rand() * eligible.length)];
    if (!answer || used.has(answer.id)) continue;

    const clues = buildClues(answer, minGoalsClue, opts.seasonLabel);

    // Distractors: same position (so the position clue doesn't trivially solve
    // it), excluded by ≥1 KNOWN clue, and not the answer.
    const samePos = players.filter(
      (p) => p.id !== answer.id && p.position === answer.position && isExcluded(p, clues),
    );
    if (samePos.length < 3) continue;
    // Prefer distractors of comparable fame to the answer (plausibility).
    const ranked = samePos
      .map((p) => ({ p, gap: Math.abs(fame.fame(p.id) - fame.fame(answer.id)) + rand() * 20 }))
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 8);
    const distractors = shuffle(ranked.map((r) => r.p), rand).slice(0, 3);
    if (distractors.length < 3) continue;

    // CLEAN GATE: exactly one option (the answer) consistent with all clues.
    if (distractors.some((d) => !isExcluded(d, clues))) continue;

    used.add(answer.id);
    const options = shuffle([answer, ...distractors], rand).map((p) => ({
      id: p.id,
      label: p.name,
    }));
    out.push({
      format: "who-am-i",
      prompt: clues.map((c) => c.line).join("\n"),
      options,
      answerId: answer.id,
      difficulty: difficultyFor(answer, distractors, fame),
      positions: [answer.position],
      meta: { answer: answer.name, club: answer.club },
    });
  }
  return out;
}

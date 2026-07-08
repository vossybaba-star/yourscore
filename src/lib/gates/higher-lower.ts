/**
 * Higher/Lower + This-season form generators.
 *
 * Both are two-player comparisons on a stat. The generator's whole job is to
 * produce instances that are CLEAN — one unambiguous answer — because a bad
 * question dents trust and, in the real game, a player's budget. So the validator
 * rejects near-ties and thin data before a question is ever emitted.
 */

import {
  type GateFormat,
  type GateQuestion,
  type GateStat,
  type Player,
  STAT_LABEL,
  statValue,
} from "./types";
import { buildFameIndex, closeness, comparisonDifficulty, type FameIndex } from "./fame";
import { seededRng } from "./rng";

export interface HigherLowerOpts {
  stat: GateStat;
  seed: string;
  count?: number; // target number of questions (default 40)
  /** Min relative gap between the two values to count as unambiguous. */
  minMargin?: number; // default 0.15
  /** The bigger of the two values must be at least this (skips 0-vs-0 noise). */
  minTop?: number; // default per-stat
  /** Sampling attempts cap (default count * 25). */
  attempts?: number;
}

/** Sensible floor for the top value so comparisons aren't trivial/noise. */
const DEFAULT_MIN_TOP: Record<GateStat, number> = {
  price: 0, // every player has a price
  goals: 2,
  assists: 2,
  appearances: 3,
  points: 20,
  form: 1,
};

/** The question stem for each stat. */
function promptFor(stat: GateStat): string {
  if (stat === "price") return "Who's worth more?";
  if (stat === "form") return "Who's in better form?";
  return `Who has more ${STAT_LABEL[stat]}?`;
}

/**
 * Is this a clean, unambiguous comparison? (Both values present, a clear winner,
 * a meaningful margin, and the top value above the noise floor.)
 */
export function isValidComparison(
  va: number,
  vb: number,
  minMargin: number,
  minTop: number,
): boolean {
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return false;
  if (va === vb) return false;
  const top = Math.max(Math.abs(va), Math.abs(vb));
  if (top < minTop) return false;
  const margin = Math.abs(va - vb) / (top || 1);
  return margin >= minMargin;
}

function makeQuestion(
  format: GateFormat,
  stat: GateStat,
  a: Player,
  b: Player,
  fame: FameIndex,
  rand: () => number,
): GateQuestion {
  const va = statValue(a, stat);
  const vb = statValue(b, stat);
  const winner = va > vb ? a : b;
  // Randomise which player is shown first so the answer isn't positionally biased.
  const [first, second] = rand() < 0.5 ? [a, b] : [b, a];
  const positions = a.position === b.position ? [a.position] : [a.position, b.position];
  return {
    format,
    stat,
    prompt: promptFor(stat),
    options: [
      { id: first.id, label: first.name },
      { id: second.id, label: second.name },
    ],
    answerId: winner.id,
    difficulty: comparisonDifficulty(fame.fame(a.id), fame.fame(b.id), closeness(va, vb)),
    positions,
    meta: { [`${a.name}`]: va, [`${b.name}`]: vb },
  };
}

/** Core two-player-comparison generator, shared by Higher/Lower + This-season form. */
function generateComparisons(
  format: GateFormat,
  eligible: readonly Player[],
  fame: FameIndex,
  opts: HigherLowerOpts,
): GateQuestion[] {
  const { stat, seed } = opts;
  const count = opts.count ?? 40;
  const minMargin = opts.minMargin ?? 0.15;
  const minTop = opts.minTop ?? DEFAULT_MIN_TOP[stat];
  const maxAttempts = opts.attempts ?? count * 25;
  const out: GateQuestion[] = [];
  if (eligible.length < 2) return out;

  const rand = seededRng(`${seed}:${format}:${stat}`);
  const seen = new Set<string>();
  let attempts = 0;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    const i = Math.floor(rand() * eligible.length);
    let j = Math.floor(rand() * eligible.length);
    if (j === i) j = (j + 1) % eligible.length;
    const a = eligible[i];
    const b = eligible[j];
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    if (seen.has(key)) continue;
    if (!isValidComparison(statValue(a, stat), statValue(b, stat), minMargin, minTop)) continue;
    seen.add(key);
    out.push(makeQuestion(format, stat, a, b, fame, rand));
  }
  return out;
}

/** Higher or Lower — compare two players on a season/value stat. */
export function generateHigherLower(
  players: readonly Player[],
  opts: HigherLowerOpts,
): GateQuestion[] {
  const fame = buildFameIndex(players);
  return generateComparisons("higher-lower", players, fame, opts);
}

/** Minutes threshold for "regular starter" (~5 full games). */
export const REGULAR_STARTER_MINUTES = 450;

/**
 * This-season form — same comparison, but on a current-season stat and only
 * between regular starters who are currently available (so the answer is fair —
 * no comparing two players who barely feature or are injured).
 */
export function generateThisSeasonForm(
  players: readonly Player[],
  opts: Omit<HigherLowerOpts, "stat"> & { stat?: GateStat },
): GateQuestion[] {
  const stat: GateStat = opts.stat ?? "points";
  const fame = buildFameIndex(players); // fame relative to the whole pool
  const eligible = players.filter(
    (p) => p.available && p.minutes >= REGULAR_STARTER_MINUTES,
  );
  return generateComparisons("this-season-form", eligible, fame, { ...opts, stat });
}

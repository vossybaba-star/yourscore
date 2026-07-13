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
  /**
   * Minimum fame (0–100) BOTH players must clear to be eligible. Keeps the
   * comparison between players people actually recognise — no "Orford vs Talbi".
   * Fame is pool-relative (see fame.ts); default 0 = no floor.
   */
  minFame?: number;
  /**
   * The season the stats refer to, e.g. "2025/26". Season-relative stats MUST
   * be labelled explicitly (founder: "this season" goes stale the moment the
   * season rolls — every time-relative phrase needs a proper label).
   */
  seasonLabel?: string;
}

/** Sensible floor for the top value so comparisons aren't trivial/noise. */
const DEFAULT_MIN_TOP: Record<GateStat, number> = {
  price: 0, // every player has a price
  goals: 2,
  assists: 2,
  appearances: 3,
  points: 20,
  form: 1,
  age: 17, // any real player clears this — the margin does the work for age
};

/** The question stem for each stat — season-relative stats carry the label,
 *  and the price prompt names the valuation system (founder: "worth more"
 *  with no context is ambiguous). */
function promptFor(stat: GateStat, seasonLabel?: string): string {
  if (stat === "price")
    return `Who costs more in fantasy football${seasonLabel ? ` (${seasonLabel} season)` : ""}?`;
  if (stat === "age") return "Who is older?"; // age is current, not season-relative
  const label = seasonLabel ? ` in the ${seasonLabel} season` : "";
  if (stat === "form") return `Who's in better form${seasonLabel ? ` right now (${seasonLabel})` : ""}?`;
  if (stat === "goals") return `Who scored more goals${label}?`;
  if (stat === "assists") return `Who has more assists${label}?`;
  if (stat === "appearances") return `Who has more starts${label}?`;
  if (stat === "points") return `Who scored more fantasy points${label}?`;
  return `Who has more ${STAT_LABEL[stat]}${label}?`;
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
  seasonLabel?: string,
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
    prompt: promptFor(stat, seasonLabel),
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

/**
 * Core two-player-comparison generator, shared by Higher/Lower + This-season form.
 *
 * Pairs are ALWAYS same-position (founder Jul 11: comparing a keeper's goals to a
 * striker's is nonsense — a forward vs a defender on goals is trivially easy). We
 * bucket the eligible pool by position and only ever pair within a bucket, so
 * every question is "which of these two <forwards / midfielders / …> …".
 */
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
  const maxAttempts = opts.attempts ?? count * 40;
  const out: GateQuestion[] = [];
  if (eligible.length < 2) return out;

  // Bucket by position; only positions with ≥2 players can form a pair.
  const byPos = new Map<Player["position"], Player[]>();
  for (const p of eligible) {
    const arr = byPos.get(p.position);
    if (arr) arr.push(p);
    else byPos.set(p.position, [p]);
  }
  const positions = Array.from(byPos.keys()).filter((pos) => (byPos.get(pos)?.length ?? 0) >= 2);
  if (positions.length === 0) return out;

  const rand = seededRng(`${seed}:${format}:${stat}`);
  const seen = new Set<string>();
  let attempts = 0;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    const pos = positions[Math.floor(rand() * positions.length)];
    const bucket = byPos.get(pos)!;
    const i = Math.floor(rand() * bucket.length);
    let j = Math.floor(rand() * bucket.length);
    if (j === i) j = (j + 1) % bucket.length;
    const a = bucket[i];
    const b = bucket[j];
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    if (seen.has(key)) continue;
    if (!isValidComparison(statValue(a, stat), statValue(b, stat), minMargin, minTop)) continue;
    seen.add(key);
    out.push(makeQuestion(format, stat, a, b, fame, rand, opts.seasonLabel));
  }
  return out;
}

/** Higher or Lower — compare two players on a season/value stat. */
export function generateHigherLower(
  players: readonly Player[],
  opts: HigherLowerOpts,
): GateQuestion[] {
  // Fame is indexed over the FULL pool (correct normalization), then the floor
  // filters the eligible players — so a well-known-players-only round still
  // rates fame relative to everyone.
  const fame = buildFameIndex(players);
  const minFame = opts.minFame ?? 0;
  const famed = minFame > 0 ? players.filter((p) => fame.fame(p.id) >= minFame) : players;
  // Age is the one stat that can be MISSING (a player who wasn't SM-enriched has
  // no age → statValue returns 0). Comparing "age 0" is nonsense, so require a
  // real age for the age topic. Other stats read 0 as a genuine value.
  const eligible =
    opts.stat === "age" ? famed.filter((p) => typeof p.age === "number" && p.age >= 15) : famed;
  return generateComparisons("higher-lower", eligible, fame, opts);
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
  const minFame = opts.minFame ?? 0;
  const eligible = players.filter(
    (p) =>
      p.available &&
      p.minutes >= REGULAR_STARTER_MINUTES &&
      (minFame <= 0 || fame.fame(p.id) >= minFame),
  );
  return generateComparisons("this-season-form", eligible, fame, { ...opts, stat });
}

/**
 * 38-0 Interactive penalty shootout — pure kick mechanics (deterministic, seeded).
 *
 * Every drawn played match goes to penalties, and the user takes them: pick one of
 * six aim zones to shoot, pick a column to dive as keeper. The AI keeper / CPU
 * shooter and every outcome draw from per-kick sub-seeds, so a kick resolved live
 * on the server is byte-identical to a later full recompute (the auto-fill for
 * timeouts and abandonment never shifts the kicks that were actually taken).
 *
 * Risk model: corners convert best but carry a wild-miss tax; center is safe from
 * misses but punished hard when the keeper stays home. Every strategy lands in the
 * ~0.72–0.80 conversion band (consistent with the legacy auto pConvert 0.72), and a
 * correctly guessed dive saves a meaningful fraction — no Strength lean, pens are
 * player skill + seeded luck.
 *
 * Type-strippable (no enums) so it runs under `node --test`, like score.ts.
 */

import { seededRng } from "./score";

// ─── Zones ─────────────────────────────────────────────────────────────────────

/** Aim zones, shooter's view: 0/1/2 = low left/center/right, 3/4/5 = high L/C/R. */
export type PenZone = 0 | 1 | 2 | 3 | 4 | 5;
/** Keeper dive: 0 = left, 1 = stay center, 2 = right (shooter's view). */
export type PenColumn = 0 | 1 | 2;
export type KickOutcome = "goal" | "saved" | "missed";
/** One resolved kick, as stored (jsonb-friendly). `dive` is the defending keeper's pick. */
export type PenKick = { shot: PenZone; dive: PenColumn; outcome: KickOutcome };
export type PensMode = "alternating" | "simultaneous";

export const zoneColumn = (z: PenZone): PenColumn => (z % 3) as PenColumn;
export const isHigh = (z: PenZone): boolean => z >= 3;

type ZoneClass = "centerLow" | "centerHigh" | "cornerLow" | "cornerHigh";
const zoneClass = (z: PenZone): ZoneClass =>
  zoneColumn(z) === 1 ? (isHigh(z) ? "centerHigh" : "centerLow") : isHigh(z) ? "cornerHigh" : "cornerLow";

// ─── Tunables (one place — adjust after playtesting) ──────────────────────────

export const PENS_CONFIG = {
  /** Regulation kicks per side. */
  rounds: 5,
  /** Sudden-death rounds before the deterministic backstop settles it. */
  maxSuddenDeathRounds: 20,
  /** P(shot off target) by zone class — corners/high carry the miss tax. */
  miss: { centerLow: 0.01, centerHigh: 0.06, cornerLow: 0.05, cornerHigh: 0.1 },
  /** P(save) when the keeper picked the shot's column — top corners are nearly
   *  unsaveable even when read; a center shot at a keeper who stayed is bread. */
  saveMatched: { centerLow: 0.9, centerHigh: 0.65, cornerLow: 0.5, cornerHigh: 0.3 },
  /** AI keeper column distribution [left, center, right] — stays home often
   *  enough that lazy center shots get punished. */
  keeperBias: [0.36, 0.28, 0.36],
  /** CPU shooter: mostly corners, a fair share of them high. */
  cpuShot: { cornerShare: 0.7, highShare: 0.45, centerHighShare: 0.25 },
} as const;

// ─── AI picks + single-kick outcome ────────────────────────────────────────────

export function aiKeeperColumn(rng: () => number): PenColumn {
  const [l, c] = PENS_CONFIG.keeperBias;
  const r = rng();
  return r < l ? 0 : r < l + c ? 1 : 2;
}

export function aiShotZone(rng: () => number): PenZone {
  const { cornerShare, highShare, centerHighShare } = PENS_CONFIG.cpuShot;
  if (rng() < cornerShare) {
    const col: PenColumn = rng() < 0.5 ? 0 : 2;
    return (rng() < highShare ? col + 3 : col) as PenZone;
  }
  return rng() < centerHighShare ? 4 : 1;
}

/** Resolve one kick: wild-miss roll first, then the save roll if the keeper read
 *  the column, else it's in. */
export function kickOutcome(shot: PenZone, dive: PenColumn, rng: () => number): KickOutcome {
  const cls = zoneClass(shot);
  if (rng() < PENS_CONFIG.miss[cls]) return "missed";
  if (dive === zoneColumn(shot) && rng() < PENS_CONFIG.saveMatched[cls]) return "saved";
  return "goal";
}

/**
 * THE shared primitive: resolve side `side`'s kick number `round` (1-based) of the
 * shootout keyed by `seed`. Each kick draws from fresh sub-seeds
 * `${seed}:${side}:${round}:shot|dive|out`, so a missing/auto-filled input NEVER
 * shifts any other kick — per-kick server resolution and a later full recompute
 * are byte-identical. Absent `shot` → seeded CPU shot; absent `dive` → seeded AI
 * keeper.
 */
export function resolveRound(
  seed: string,
  side: "a" | "b",
  round: number,
  input: { shot?: PenZone; dive?: PenColumn }
): PenKick {
  const shot = input.shot ?? aiShotZone(seededRng(`${seed}:${side}:${round}:shot`));
  const dive = input.dive ?? aiKeeperColumn(seededRng(`${seed}:${side}:${round}:dive`));
  const outcome = kickOutcome(shot, dive, seededRng(`${seed}:${side}:${round}:out`));
  return { shot, dive, outcome };
}

// ─── Shootout state ────────────────────────────────────────────────────────────

export type ShootoutStatus = {
  aGoals: number;
  bGoals: number;
  decided: boolean;
  winner: "a" | "b" | null;
  /** Both sides past regulation. */
  suddenDeath: boolean;
  /** Alternating mode: whose kick is due (a kicks first). Simultaneous mode: the
   *  side with fewer kicks ("a" on ties) — gate per side with kickAllowed. Null
   *  when decided. */
  next: "a" | "b" | null;
  /** The due side's next round number (1-based). 0 when decided. */
  round: number;
};

const goalsOf = (kicks: PenKick[]): number => kicks.reduce((s, k) => s + (k.outcome === "goal" ? 1 : 0), 0);

/**
 * Pure scoreboard logic for both presentations.
 * - `alternating` (solo: a kicks first, lengths differ by ≤1): standard early
 *   termination — decided as soon as the lead exceeds the trailing side's
 *   remaining regulation kicks.
 * - `simultaneous` (live: both shoot their 5 ungated — trivial sync): decided only
 *   at equal counts ≥ rounds with the scores apart; sudden-death round r+1 opens
 *   when both have r kicks and are level.
 */
export function shootoutStatus(
  a: PenKick[],
  b: PenKick[],
  mode: PensMode,
  rounds: number = PENS_CONFIG.rounds
): ShootoutStatus {
  const aGoals = goalsOf(a);
  const bGoals = goalsOf(b);
  const suddenDeath = a.length >= rounds && b.length >= rounds;

  let decided = false;
  if (mode === "alternating" && (a.length < rounds || b.length < rounds)) {
    const remA = Math.max(0, rounds - a.length);
    const remB = Math.max(0, rounds - b.length);
    decided = aGoals > bGoals + remB || bGoals > aGoals + remA;
  } else if (a.length === b.length && a.length >= rounds) {
    decided = aGoals !== bGoals;
  }
  const winner = decided ? (aGoals > bGoals ? "a" : "b") : null;

  let next: "a" | "b" | null = null;
  if (!decided) next = a.length <= b.length ? "a" : "b";
  const round = next ? (next === "a" ? a.length : b.length) + 1 : 0;
  return { aGoals, bGoals, decided, winner, suddenDeath, next, round };
}

/** May `side` take their next kick right now? (Server-side gate for per-kick
 *  submission.) Simultaneous regulation is ungated; sudden death opens a round
 *  only when both sides have completed the previous one level. */
export function kickAllowed(
  a: PenKick[],
  b: PenKick[],
  side: "a" | "b",
  mode: PensMode,
  rounds: number = PENS_CONFIG.rounds
): boolean {
  const st = shootoutStatus(a, b, mode, rounds);
  if (st.decided) return false;
  const mine = side === "a" ? a : b;
  const theirs = side === "a" ? b : a;
  if (mine.length >= rounds + PENS_CONFIG.maxSuddenDeathRounds) return false;
  if (mode === "alternating") return st.next === side;
  if (mine.length < rounds) return true;
  // Sudden death: finish an open round, or start the next when level after a full pair.
  return mine.length < theirs.length || (mine.length === theirs.length && theirs.length >= rounds);
}

// ─── Full resolution (auto-fill for timeouts / abandonment / bots) ────────────

export type ShootoutInputs = {
  aShots?: PenZone[];
  /** a's keeper dives AGAINST b's kicks (index = b's round - 1). */
  aDives?: PenColumn[];
  bShots?: PenZone[];
  bDives?: PenColumn[];
};

/**
 * Deterministic full resolution: submitted inputs are honored verbatim (same
 * per-round sub-seeds as the live path), anything missing is seeded auto-fill.
 * Always decisive — after maxSuddenDeathRounds a seeded coin settles it (the
 * backstop bumps the score without a kick; vanishingly rare).
 */
export function resolveInteractiveShootout(
  seed: string,
  inputs: ShootoutInputs,
  mode: PensMode,
  rounds: number = PENS_CONFIG.rounds
): { a: PenKick[]; b: PenKick[]; score: { a: number; b: number }; winner: "a" | "b" } {
  const a: PenKick[] = [];
  const b: PenKick[] = [];
  const cap = 2 * (rounds + PENS_CONFIG.maxSuddenDeathRounds);
  while (a.length + b.length < cap) {
    const st = shootoutStatus(a, b, mode, rounds);
    if (st.decided) break;
    const side = st.next as "a" | "b";
    const round = st.round;
    const kick =
      side === "a"
        ? resolveRound(seed, "a", round, { shot: inputs.aShots?.[round - 1], dive: inputs.bDives?.[round - 1] })
        : resolveRound(seed, "b", round, { shot: inputs.bShots?.[round - 1], dive: inputs.aDives?.[round - 1] });
    (side === "a" ? a : b).push(kick);
  }
  const score = { a: goalsOf(a), b: goalsOf(b) };
  let winner: "a" | "b";
  if (score.a !== score.b) {
    winner = score.a > score.b ? "a" : "b";
  } else {
    winner = seededRng(`${seed}:backstop`)() < 0.5 ? "a" : "b"; // guard exhausted — settle it
    score[winner]++;
  }
  return { a, b, score, winner };
}

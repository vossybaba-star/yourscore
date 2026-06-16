/**
 * 38-0 Interactive penalty shootout — pure kick mechanics (deterministic, seeded).
 *
 * Every drawn played match goes to penalties, and the user takes them: pick one of
 * NINE aim zones (3 columns × 3 heights), time the POWER meter, and — as keeper —
 * pick a column to dive. The AI keeper / CPU shooter and every outcome draw from
 * per-kick sub-seeds, so a kick resolved live on the server is byte-identical to a
 * later full recompute (the auto-fill for timeouts / abandonment never shifts the
 * kicks that were actually taken).
 *
 * Skill model:
 *  - Placement: top corners are the hardest to save but carry a real wild-miss tax;
 *    low/center is safe from misses but easy to save if the keeper reads it.
 *  - Power: PERFECT timing maximises conversion; OVER blazes it over/wide; UNDER is
 *    soft and saveable; GOOD is solid. No Strength lean — pens are pure skill + luck.
 *
 * Net conversion sits around the legacy auto rate (~0.72) for a CPU/auto kick and
 * climbs toward ~0.85 for a well-placed, perfectly-struck one.
 *
 * Type-strippable (no enums) so it runs under `node --test`, like score.ts.
 */

import { seededRng } from "./score";

// ─── Zones, power, keeper ──────────────────────────────────────────────────────

/** Aim zones, shooter's view: row 0 = low, 1 = mid, 2 = high; col = L/C/R.
 *  0,1,2 low L/C/R · 3,4,5 mid L/C/R · 6,7,8 high L/C/R. */
export type PenZone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** Power-meter band the strike landed in (where the needle stopped). */
export type PenPower = "under" | "good" | "perfect" | "over";
/** A goal-mouth column: 0 = left, 1 = centre, 2 = right (shooter's view). */
export type PenColumn = 0 | 1 | 2;
export type KickOutcome = "goal" | "saved" | "missed";
/** One resolved kick, as stored (jsonb-friendly). `dive` is the defending keeper's
 *  pick — now a full 9-zone (PenZone), same grid the shooter aims at. */
export type PenKick = { shot: PenZone; power: PenPower; dive: PenZone; outcome: KickOutcome };
export type PensMode = "alternating" | "simultaneous";

export const POWERS: PenPower[] = ["under", "good", "perfect", "over"];
export const zoneColumn = (z: PenZone): PenColumn => (z % 3) as PenColumn;
export const zoneRow = (z: PenZone): 0 | 1 | 2 => Math.floor(z / 3) as 0 | 1 | 2;
export const isHigh = (z: PenZone): boolean => zoneRow(z) === 2;
export const isCorner = (z: PenZone): boolean => zoneColumn(z) !== 1;

// ─── Tunables (one place — adjust after playtesting) ──────────────────────────

export const PENS_CONFIG = {
  /** Regulation kicks per side. */
  rounds: 5,
  /** Sudden-death rounds before the deterministic backstop settles it. */
  maxSuddenDeathRounds: 20,
  /** Base P(shot off target) by row [low, mid, high] — height = placement risk. */
  rowMiss: [0.01, 0.03, 0.11],
  /** Extra P(miss) for a corner vs a central column (wide risk). */
  cornerMiss: 0.04,
  /** P(save) when the keeper dives to the EXACT shot zone, by row [low, mid, high]
   *  — top corners stay hard to keep out even when read dead-on. */
  saveExact: [0.82, 0.74, 0.5],
  /** P(save) when the keeper is one cell off along a single axis (right side wrong
   *  height, or right height wrong side) — a stretch that reaches sometimes. */
  saveAdjacent: 0.34,
  /** P(save) when the keeper is one cell off diagonally — a desperate fingertip. */
  saveDiagonal: 0.12,
  /** Power band effects. */
  power: {
    /** Added to P(miss) (clamped ≥ 0). OVER blazes it; PERFECT places it. */
    miss: { under: 0.02, good: 0.0, perfect: -0.05, over: 0.24 },
    /** Multiplier on the save chance. PERFECT beats the dive; UNDER is soft. */
    saveMul: { under: 1.4, good: 1.05, perfect: 0.66, over: 0.92 },
  },
  /** AI keeper pick distribution: column [left, center, right] × row [low, mid, high]
   *  — covers the corners but rarely flies to the top, like a real keeper. */
  keeperBias: [0.37, 0.26, 0.37],
  keeperRowBias: [0.42, 0.4, 0.18],
  /** CPU shooter tendencies. */
  cpu: {
    cornerShare: 0.66,      // aims at a corner column this often (else center)
    rowWeights: [0.42, 0.32, 0.26], // low / mid / high
    powerWeights: { under: 0.12, good: 0.42, perfect: 0.34, over: 0.12 },
  },
} as const;

// ─── AI picks + single-kick outcome ────────────────────────────────────────────

/** Seeded AI keeper pick — a full 9-zone dive (column × row biased). */
export function aiKeeperZone(rng: () => number): PenZone {
  const [l, c] = PENS_CONFIG.keeperBias;
  const rc = rng();
  const col = rc < l ? 0 : rc < l + c ? 1 : 2;
  const rw = PENS_CONFIG.keeperRowBias;
  let rr = rng();
  let row = 0;
  for (let i = 0; i < 3; i++) { if ((rr -= rw[i]) <= 0) { row = i; break; } }
  return (row * 3 + col) as PenZone;
}

export function aiPower(rng: () => number): PenPower {
  const w = PENS_CONFIG.cpu.powerWeights;
  let r = rng();
  for (const p of POWERS) { if ((r -= w[p]) <= 0) return p; }
  return "good";
}

export function aiShotZone(rng: () => number): PenZone {
  const col: PenColumn = rng() < PENS_CONFIG.cpu.cornerShare ? (rng() < 0.5 ? 0 : 2) : 1;
  const rw = PENS_CONFIG.cpu.rowWeights;
  let r = rng();
  let row = 0;
  for (let i = 0; i < 3; i++) { if ((r -= rw[i]) <= 0) { row = i; break; } }
  return (row * 3 + col) as PenZone;
}

/** Resolve one kick: wild-miss roll first (placement + power), then a save roll
 *  scaled by how well the keeper's 9-zone dive covers the shot zone — exact cell,
 *  one cell off on a single axis (adjacent), or one cell off diagonally. */
export function kickOutcome(shot: PenZone, power: PenPower, dive: PenZone, rng: () => number): KickOutcome {
  const row = zoneRow(shot);
  const missP = Math.max(0, PENS_CONFIG.rowMiss[row] + (isCorner(shot) ? PENS_CONFIG.cornerMiss : 0) + PENS_CONFIG.power.miss[power]);
  if (rng() < missP) return "missed";
  const dcol = Math.abs(zoneColumn(shot) - zoneColumn(dive));
  const drow = Math.abs(zoneRow(shot) - zoneRow(dive));
  let base = 0;
  if (dcol === 0 && drow === 0) base = PENS_CONFIG.saveExact[row];
  else if ((dcol === 0 && drow === 1) || (drow === 0 && dcol === 1)) base = PENS_CONFIG.saveAdjacent;
  else if (dcol <= 1 && drow <= 1) base = PENS_CONFIG.saveDiagonal;
  if (base > 0) {
    const saveP = Math.min(0.95, base * PENS_CONFIG.power.saveMul[power]);
    if (rng() < saveP) return "saved";
  }
  return "goal";
}

/**
 * THE shared primitive: resolve side `side`'s kick number `round` (1-based) of the
 * shootout keyed by `seed`. Each kick draws from fresh sub-seeds
 * `${seed}:${side}:${round}:shot|power|dive|out`, so a missing/auto-filled input
 * NEVER shifts any other kick — per-kick server resolution and a later full
 * recompute are byte-identical. Absent `shot`/`power` → seeded CPU strike; absent
 * `dive` → seeded AI keeper.
 */
export function resolveRound(
  seed: string,
  side: "a" | "b",
  round: number,
  input: { shot?: PenZone; power?: PenPower; dive?: PenZone }
): PenKick {
  const shot = input.shot ?? aiShotZone(seededRng(`${seed}:${side}:${round}:shot`));
  const power = input.power ?? aiPower(seededRng(`${seed}:${side}:${round}:power`));
  const dive = input.dive ?? aiKeeperZone(seededRng(`${seed}:${side}:${round}:dive`));
  const outcome = kickOutcome(shot, power, dive, seededRng(`${seed}:${side}:${round}:out`));
  return { shot, power, dive, outcome };
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
  aPowers?: PenPower[];
  /** a's keeper dives AGAINST b's kicks (index = b's round - 1). 9-zone picks. */
  aDives?: PenZone[];
  bShots?: PenZone[];
  bPowers?: PenPower[];
  bDives?: PenZone[];
};

/**
 * Deterministic full resolution: submitted inputs are honored verbatim (same
 * per-round sub-seeds as the live path), anything missing is seeded auto-fill.
 * Always decisive — after maxSuddenDeathRounds a seeded coin settles it.
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
        ? resolveRound(seed, "a", round, { shot: inputs.aShots?.[round - 1], power: inputs.aPowers?.[round - 1], dive: inputs.bDives?.[round - 1] })
        : resolveRound(seed, "b", round, { shot: inputs.bShots?.[round - 1], power: inputs.bPowers?.[round - 1], dive: inputs.aDives?.[round - 1] });
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

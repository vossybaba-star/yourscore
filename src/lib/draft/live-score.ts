/**
 * 38-0 Live Multiplayer — match engine (pure, deterministic, server-authoritative).
 *
 * Live H2H is a two-half match: a half's goals come from each side's Strength
 * Rating (recomputed by score.ts after swaps), split by winProbability and drawn
 * from a Poisson keyed on a seeded RNG so the server can resolve reproducibly and
 * audit-ably. A level aggregate may go to an OPT-IN penalty shootout.
 *
 * Type-strippable (no enums) so it runs under `node --test`, like score.ts.
 */

import type { PlacedPlayer, Position } from "./types";
import { lineRatings, posCategory, seededRng } from "./score";
import { poisson, resolveHalfGoals, attackShare } from "./match";

// Re-export the Poisson sampler from its new home so existing importers keep working.
export { poisson };

// ─── Tunables (one place — adjust after playtesting) ──────────────────────────

export const LIVE_CONFIG = {
  /** Seconds per phase. lobby waits on both-ready (no deadline). */
  timers: {
    reveal: 15,
    pregame_swap: 25,
    // Each half plays out on screen over 45s as a highlight reel — see playback.ts / pitch.ts.
    half1: 45,
    halftime_swap: 35,
    half2: 45,
    draw_decision: 15,
    penalties: 7,
  },
  /** Swap budgets per player. */
  swaps: { pregame: 1, halftime: 2 },
  /** Penalty conversion: near coin-flip with only a faint Strength lean. */
  pens: { base: 0.72, lean: 0.0015, min: 0.6, max: 0.82, rounds: 5 },
} as const;

// ─── Phases ───────────────────────────────────────────────────────────────────

export type LivePhase =
  | "lobby" | "reveal" | "pregame_swap" | "half1" | "halftime_swap"
  | "half2" | "draw_decision" | "penalties" | "result" | "abandoned";

// ─── Goals ─────────────────────────────────────────────────────────────────────
// The goal model (poisson, resolveHalfGoals, attackShare) lives in match.ts and is
// shared with the season sim and the one-shot match — see imports above.

/** Aggregate the two halves. `level` flags a tie (which may go to penalties). */
export function aggregate(
  h1: { a: number; b: number },
  h2: { a: number; b: number }
): { a: number; b: number; level: boolean } {
  const a = h1.a + h2.a;
  const b = h1.b + h2.b;
  return { a, b, level: a === b };
}

// ─── Penalties (opt-in, near coin-flip) ────────────────────────────────────────

function pConvert(self: number, opp: number): number {
  const { base, lean, min, max } = LIVE_CONFIG.pens;
  const p = base + (self - opp) * lean;
  return Math.max(min, Math.min(max, p));
}

/**
 * Seeded penalty shootout: `rounds` kicks each, then sudden death until decided.
 * Slight Strength lean on conversion, so it feels like a lottery. Always returns
 * a decisive (a !== b) result.
 */
export function resolveShootout(a: number, b: number, rng: () => number): { a: number; b: number } {
  const pA = pConvert(a, b);
  const pB = pConvert(b, a);
  let ga = 0;
  let gb = 0;
  for (let i = 0; i < LIVE_CONFIG.pens.rounds; i++) {
    if (rng() < pA) ga++;
    if (rng() < pB) gb++;
  }
  // Sudden death — one pair of kicks per round until they differ.
  let guard = 0;
  while (ga === gb && guard++ < 100) {
    const sa = rng() < pA ? 1 : 0;
    const sb = rng() < pB ? 1 : 0;
    ga += sa;
    gb += sb;
  }
  if (ga === gb) ga++; // deterministic backstop (guard exhausted — vanishingly rare)
  return { a: ga, b: gb };
}

// ─── Phase transitions (pure — the DB layer enforces idempotency) ──────────────

export interface PhaseInput {
  phase: LivePhase;
  /** Both players have confirmed/readied for this phase. */
  bothReady: boolean;
  /** now >= phase_deadline. */
  expired: boolean;
  /** Aggregate is level (only meaningful at half2 / draw_decision). */
  level: boolean;
  /** Both players opted into penalties (only meaningful at draw_decision). */
  bothWantPens: boolean;
}

/**
 * The next phase given the current state. Pure and deterministic: same input →
 * same output. Idempotency of the *transition* (applying it once) is enforced by
 * the conditional UPDATE in the advance endpoint; this only decides the target.
 *
 * - `lobby` waits for both-ready (no deadline).
 * - Every other phase advances on both-ready OR deadline.
 * - `half2` → `draw_decision` if level, else `result`.
 * - `draw_decision` → `penalties` only if BOTH opted in, else `result` (a draw).
 */
export function nextPhase(s: PhaseInput): LivePhase {
  const advance = s.bothReady || s.expired;
  switch (s.phase) {
    case "lobby":         return s.bothReady ? "reveal" : (s.expired ? "abandoned" : "lobby");
    case "reveal":        return advance ? "pregame_swap" : "reveal";
    case "pregame_swap":  return advance ? "half1" : "pregame_swap";
    case "half1":         return advance ? "halftime_swap" : "half1";
    case "halftime_swap": return advance ? "half2" : "halftime_swap";
    case "half2":         return advance ? (s.level ? "draw_decision" : "result") : "half2";
    case "draw_decision": return advance ? (s.bothWantPens ? "penalties" : "result") : "draw_decision";
    case "penalties":     return advance ? "result" : "penalties";
    default:              return s.phase; // result / abandoned are terminal
  }
}

// ─── Match simulation — scorers, assists, ratings, corners, throw-ins ──────────
// Layered on top of the goal model (resolveHalfGoals stays the source of truth for
// the scoreline). Pure + seeded, so the server resolves it once and stores it.

export type GoalEvent = {
  side: "a" | "b";              // a = p1, b = p2 (matches h1_p1 / h1_p2)
  minute: number;
  scorerId: string; scorerName: string;
  assistId?: string; assistName?: string;
};

export type PlayerRating = {
  id: string; name: string; pos: Position;
  goals: number; assists: number;
  rating: number;               // 4.5–9.8
};

type Pair = { a: number; b: number };
export type HalfSim = {
  goals: Pair;
  possession: Pair;       // % (a + b = 100)
  shots: Pair;
  shotsOnTarget: Pair;
  corners: Pair;
  fouls: Pair;
  offsides: Pair;
  throwins: Pair;
  events: GoalEvent[];
  ratingsA: PlayerRating[];
  ratingsB: PlayerRating[];
};

/** Accumulated across the match (written half-by-half on the live row). */
export type MatchSim = { h1?: HalfSim; h2?: HalfSim };

// Goal/assist propensity by position × quality (mirrors season.ts:173–174).
const goalWeight = (p: PlacedPlayer): number =>
  ({ att: 1, mid: 0.4, def: 0.1, gk: 0 } as Record<string, number>)[posCategory(p.slotPos)] * (0.6 + p.overall / 100);
const assistWeight = (p: PlacedPlayer): number =>
  ({ att: 0.7, mid: 1, def: 0.35, gk: 0.02 } as Record<string, number>)[posCategory(p.slotPos)] * (0.6 + p.overall / 100);

/** Weighted random pick from a squad (optionally excluding one player). */
function weightedPick(squad: PlacedPlayer[], weight: (p: PlacedPlayer) => number, rng: () => number, excludeId?: string): PlacedPlayer | null {
  const pool = excludeId ? squad.filter((p) => p.player_season_id !== excludeId) : squad;
  const total = pool.reduce((s, p) => s + weight(p), 0);
  if (pool.length === 0) return null;
  if (total <= 0) return pool[0];
  let r = rng() * total;
  for (const p of pool) { r -= weight(p); if (r <= 0) return p; }
  return pool[pool.length - 1];
}

/** Split an integer total into two sides by a share in [0,1] (per-unit Bernoulli). */
function splitTotal(total: number, shareA: number, rng: () => number): { a: number; b: number } {
  let a = 0;
  for (let i = 0; i < total; i++) if (rng() < shareA) a++;
  return { a, b: total - a };
}

/** Per-player ratings for one side this half: base 6.0 + quality tilt + noise +
 *  goal/assist bonuses + clean-sheet / heavy-concession swing for GK & DEF. */
function rateSide(
  squad: PlacedPlayer[], goalsFor: number, goalsAgainst: number,
  scorers: Map<string, number>, assisters: Map<string, number>, rng: () => number
): PlayerRating[] {
  return squad.map((p) => {
    const g = scorers.get(p.player_season_id) ?? 0;
    const a = assisters.get(p.player_season_id) ?? 0;
    let r = 6.0 + (p.overall - 75) / 40 + (rng() - 0.5) * 1.2;
    r += g * 1.0 + a * 0.6;
    const cat = posCategory(p.slotPos);
    if (cat === "gk" || cat === "def") {
      if (goalsAgainst === 0) r += 0.7;
      else if (goalsAgainst >= 2) r -= 0.5 * (goalsAgainst - 1);
    } else if (cat === "att" && goalsFor === 0) {
      r -= 0.3;
    }
    return { id: p.player_season_id, name: p.name, pos: p.slotPos, goals: g, assists: a, rating: Math.max(4.5, Math.min(9.8, Math.round(r * 10) / 10)) };
  });
}

/** Simulate one half: the scoreline (line-based resolveHalfGoals — each side's attack
 *  vs the other's defence) plus corners, throw-ins, goal events (scorer/assist/minute)
 *  and per-player ratings. Deterministic by seed. */
export function simulateHalf(
  squadA: PlacedPlayer[], squadB: PlacedPlayer[], half: 1 | 2, seed: string
): HalfSim {
  const rng = seededRng(seed);
  const linesA = lineRatings(squadA);
  const linesB = lineRatings(squadB);
  const goals = resolveHalfGoals(linesA, linesB, rng);
  const shareA = attackShare(linesA, linesB);
  // Corners lean to the stronger side and a bit of variance reads fine at low counts.
  const corners = splitTotal(poisson(5, rng), shareA, rng);
  // Throw-ins are roughly even — split near-proportionally (±1) so it never lands
  // at something silly like 16–2.
  const throwTotal = poisson(18, rng);
  const throwA = Math.max(0, Math.min(throwTotal, Math.round(throwTotal * (0.5 + (shareA - 0.5) * 0.25) + (rng() - 0.5) * 2)));
  const throwins = { a: throwA, b: throwTotal - throwA };

  // Possession follows the strength share with a little noise (clamped sane).
  const posA = Math.max(28, Math.min(72, Math.round(shareA * 100 + (rng() - 0.5) * 8)));
  const possession = { a: posA, b: 100 - posA };
  // Shots scale with the chance share; on-target is a subset but never < goals.
  const shots = {
    a: goals.a + poisson(2 + 6 * shareA, rng),
    b: goals.b + poisson(2 + 6 * (1 - shareA), rng),
  };
  const shotsOnTarget = {
    a: Math.max(goals.a, Math.round(shots.a * (0.35 + rng() * 0.15))),
    b: Math.max(goals.b, Math.round(shots.b * (0.35 + rng() * 0.15))),
  };
  const fouls = splitTotal(poisson(11, rng), 0.5, rng);
  const offsides = splitTotal(poisson(3, rng), 0.5 + (shareA - 0.5) * 0.4, rng);

  const base = half === 1 ? 0 : 45;
  const events: GoalEvent[] = [];
  const scA = new Map<string, number>(), asA = new Map<string, number>();
  const scB = new Map<string, number>(), asB = new Map<string, number>();

  const addGoals = (side: "a" | "b", n: number, squad: PlacedPlayer[], sc: Map<string, number>, as: Map<string, number>) => {
    for (let i = 0; i < n; i++) {
      const scorer = weightedPick(squad, goalWeight, rng);
      if (!scorer) continue;
      sc.set(scorer.player_season_id, (sc.get(scorer.player_season_id) ?? 0) + 1);
      let assistId: string | undefined, assistName: string | undefined;
      if (rng() < 0.75) {
        const assister = weightedPick(squad, assistWeight, rng, scorer.player_season_id);
        if (assister) { assistId = assister.player_season_id; assistName = assister.name; as.set(assistId, (as.get(assistId) ?? 0) + 1); }
      }
      events.push({ side, minute: base + 1 + Math.floor(rng() * 45), scorerId: scorer.player_season_id, scorerName: scorer.name, assistId, assistName });
    }
  };
  addGoals("a", goals.a, squadA, scA, asA);
  addGoals("b", goals.b, squadB, scB, asB);
  events.sort((x, y) => x.minute - y.minute);

  return {
    goals, possession, shots, shotsOnTarget, corners, fouls, offsides, throwins, events,
    ratingsA: rateSide(squadA, goals.a, goals.b, scA, asA, rng),
    ratingsB: rateSide(squadB, goals.b, goals.a, scB, asB, rng),
  };
}

// ─── Full-time report (merge both halves) ─────────────────────────────────────

export type SideTotals = {
  goals: number; possession: number; shots: number; shotsOnTarget: number;
  corners: number; fouls: number; offsides: number; throwins: number;
};
export type MatchReport = {
  a: SideTotals; b: SideTotals;
  events: GoalEvent[];
  ratingsA: PlayerRating[]; ratingsB: PlayerRating[];   // combined across halves
  potm: (PlayerRating & { side: "a" | "b" }) | null;
  bestA: PlayerRating | null; worstA: PlayerRating | null;
  bestB: PlayerRating | null; worstB: PlayerRating | null;
};

/** Combine a player's per-half ratings (average of the halves they appeared in —
 *  a half-time sub gets a rating for the half they played). */
function mergeRatings(h1?: PlayerRating[], h2?: PlayerRating[]): PlayerRating[] {
  const acc = new Map<string, { pr: PlayerRating; n: number; sum: number; g: number; a: number }>();
  for (const list of [h1, h2]) {
    if (!list) continue;
    for (const pr of list) {
      const e = acc.get(pr.id);
      if (e) { e.n++; e.sum += pr.rating; e.g += pr.goals; e.a += pr.assists; }
      else acc.set(pr.id, { pr, n: 1, sum: pr.rating, g: pr.goals, a: pr.assists });
    }
  }
  return Array.from(acc.values()).map(({ pr, n, sum, g, a }) => ({
    id: pr.id, name: pr.name, pos: pr.pos, goals: g, assists: a, rating: Math.round((sum / n) * 10) / 10,
  }));
}

const topOf = (rs: PlayerRating[]): PlayerRating | null => rs.length ? rs.reduce((m, p) => (p.rating > m.rating ? p : m)) : null;
const botOf = (rs: PlayerRating[]): PlayerRating | null => rs.length ? rs.reduce((m, p) => (p.rating < m.rating ? p : m)) : null;

/** Merge h1+h2 into the full-time view: totals, all events, combined ratings,
 *  Player of the Match and each side's best & worst performer. */
export function buildReport(sim: MatchSim): MatchReport {
  const { h1, h2 } = sim;
  const halves = [h1, h2].filter(Boolean) as HalfSim[];
  const sum = (sel: (h: HalfSim) => number) => halves.reduce((s, h) => s + sel(h), 0);
  // Possession is a % — average across the halves played, not a sum.
  const avgPoss = (side: "a" | "b") => halves.length ? Math.round(halves.reduce((s, h) => s + h.possession[side], 0) / halves.length) : 50;
  const possA = avgPoss("a");
  const a: SideTotals = {
    goals: sum((h) => h.goals.a), possession: possA,
    shots: sum((h) => h.shots.a), shotsOnTarget: sum((h) => h.shotsOnTarget.a),
    corners: sum((h) => h.corners.a), fouls: sum((h) => h.fouls.a),
    offsides: sum((h) => h.offsides.a), throwins: sum((h) => h.throwins.a),
  };
  const b: SideTotals = {
    goals: sum((h) => h.goals.b), possession: 100 - possA,
    shots: sum((h) => h.shots.b), shotsOnTarget: sum((h) => h.shotsOnTarget.b),
    corners: sum((h) => h.corners.b), fouls: sum((h) => h.fouls.b),
    offsides: sum((h) => h.offsides.b), throwins: sum((h) => h.throwins.b),
  };
  const events = [...(h1?.events ?? []), ...(h2?.events ?? [])].sort((x, y) => x.minute - y.minute);
  const ratingsA = mergeRatings(h1?.ratingsA, h2?.ratingsA);
  const ratingsB = mergeRatings(h1?.ratingsB, h2?.ratingsB);
  const bestA = topOf(ratingsA), bestB = topOf(ratingsB);
  let potm: MatchReport["potm"] = null;
  if (bestA && (!bestB || bestA.rating >= bestB.rating)) potm = { ...bestA, side: "a" };
  else if (bestB) potm = { ...bestB, side: "b" };
  return { a, b, events, ratingsA, ratingsB, potm, bestA, worstA: botOf(ratingsA), bestB, worstB: botOf(ratingsB) };
}

// ─── One-shot 90' match (quick / async / challenge) ────────────────────────────
// A single match is two halves with the SAME squads (no swap) merged into one
// report — so its scoreline aggregates to Poisson(λ) and the stored shape is
// byte-identical to the live path's detail.report (the result UI needs no special case).

export type SingleMatchResult = {
  outcome: "A" | "B" | "draw";
  goals: { a: number; b: number };
  pens: { a: number; b: number } | null;
  report: MatchReport;
  /** The two per-half sims (events + stats) so the client can play the match out.
   *  Always set by resolveMatch; optional so lighter callers/mocks needn't supply it. */
  sim?: MatchSim;
};

const meanOverall = (sq: PlacedPlayer[]): number =>
  sq.length ? sq.reduce((s, p) => s + p.overall, 0) / sq.length : 0;

/**
 * Resolve a one-off head-to-head. Deterministic by seed. A level 90' stands as a
 * draw when `allowDraw` (the 1v1 default for quick/async/challenge); otherwise it is
 * settled by a penalty shootout so the outcome is decisive.
 */
export function resolveMatch(
  squadA: PlacedPlayer[], squadB: PlacedPlayer[], seed: string,
  opts?: { allowDraw?: boolean }
): SingleMatchResult {
  const sim: MatchSim = {
    h1: simulateHalf(squadA, squadB, 1, `${seed}:h1`),
    h2: simulateHalf(squadA, squadB, 2, `${seed}:h2`),
  };
  const report = buildReport(sim);
  const a = report.a.goals;
  const b = report.b.goals;
  let outcome: SingleMatchResult["outcome"] = a > b ? "A" : b > a ? "B" : "draw";
  let pens: { a: number; b: number } | null = null;
  if (a === b && !(opts?.allowDraw ?? false)) {
    pens = resolveShootout(meanOverall(squadA), meanOverall(squadB), seededRng(`${seed}:pens`));
    outcome = pens.a > pens.b ? "A" : "B";
  }
  return { outcome, goals: { a, b }, pens, report, sim };
}

/** Mirror a report so the other side reads as "a" — used when a stored report is
 *  challenger-oriented (a = challenger) but a client needs it from its own POV. */
export function flipReport(r: MatchReport): MatchReport {
  const flip = (s: "a" | "b"): "a" | "b" => (s === "a" ? "b" : "a");
  return {
    a: r.b, b: r.a,
    events: r.events.map((e) => ({ ...e, side: flip(e.side) })),
    ratingsA: r.ratingsB, ratingsB: r.ratingsA,
    potm: r.potm ? { ...r.potm, side: flip(r.potm.side) } : null,
    bestA: r.bestB, worstA: r.worstB, bestB: r.bestA, worstB: r.worstA,
  };
}

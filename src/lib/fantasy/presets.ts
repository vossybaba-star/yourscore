/**
 * Starter-squad presets — one-tap valid 15s to break the cold-start wall.
 *
 * A new manager shouldn't have to solve a £100m knapsack before they see the
 * board. A preset drops a complete, legal squad onto the pitch in one tap; they
 * tweak from there. Presets are STARTING POINTS, not recommendations — every
 * player is chosen on real price alone (no projections, no invented data). The
 * three shapes just spend the budget differently across the pitch.
 *
 * Pure and deterministic: the squad is a function of the pool, so it's unit-
 * testable and never surprises. IDs are never hardcoded — the pool changes
 * weekly, so we solve against whatever pool is passed in, and validateSquad is
 * the final guard (with a cheapest-legal fallback if a shape can't be filled).
 */
import {
  BUDGET_TENTHS, MAX_PER_CLUB, SQUAD_QUOTA, validateSquad,
  type PoolPlayer,
} from "./engine";
import type { FantasyPos } from "./values";

/** Minimal player shape the solver needs — a subset of PoolPlayer, so the client
 *  pool (price in £m) maps in by rounding to tenths. */
export interface PresetPlayer {
  id: number;
  pos: FantasyPos;
  clubId: number;
  priceTenths: number;
}

/** A preset = a name, a one-line honest description, and a "greed" per slot.
 *  greed ∈ [0,1]: 1 = splurge (most expensive affordable), 0 = cheapest enabler.
 *  Each position's greed array length must equal its quota. */
export interface PresetShape {
  id: string;
  name: string;
  blurb: string;
  greed: Record<FantasyPos, number[]>;
}

/** The three starter shapes. Same £100m, spent differently across the pitch. */
export const PRESETS: readonly PresetShape[] = [
  {
    id: "attack",
    name: "Stacked attack",
    blurb: "Premium forwards and mids, value at the back.",
    greed: {
      FWD: [1.0, 0.95, 0.8],
      MID: [1.0, 0.9, 0.75, 0.6, 0.5],
      DEF: [0.75, 0.6, 0.5, 0.45, 0.4],
      GK: [0.6, 0.35],
    },
  },
  {
    id: "balanced",
    name: "Balanced",
    blurb: "Budget spread evenly across the squad.",
    greed: {
      FWD: [0.95, 0.88, 0.82],
      MID: [0.92, 0.86, 0.82, 0.78, 0.72],
      DEF: [0.9, 0.86, 0.82, 0.78, 0.72],
      GK: [0.85, 0.62],
    },
  },
  {
    id: "defence",
    name: "Solid at the back",
    blurb: "Strong keeper and defenders, one big striker.",
    greed: {
      FWD: [1.0, 0.65, 0.5],
      MID: [0.85, 0.75, 0.65, 0.55, 0.5],
      DEF: [1.0, 0.95, 0.85, 0.75, 0.65],
      GK: [0.9, 0.55],
    },
  },
] as const;

const POSITIONS: FantasyPos[] = ["GK", "DEF", "MID", "FWD"];

/** Cheapest legal fill of the remaining slots, ignoring the club cap — a lower
 *  bound on what the rest of the squad must cost. Used to guard each pick so we
 *  never spend past the point where the squad can still be completed. Returns
 *  Infinity if a position can't be filled from what's left. */
function minRemainingCost(
  need: Record<FantasyPos, number>,
  ascByPos: Record<FantasyPos, PresetPlayer[]>,
  used: Set<number>,
): number {
  let cost = 0;
  for (const pos of POSITIONS) {
    let want = need[pos];
    if (want <= 0) continue;
    for (const p of ascByPos[pos]) {
      if (used.has(p.id)) continue;
      cost += p.priceTenths;
      if (--want === 0) break;
    }
    if (want > 0) return Infinity; // not enough players left in this position
  }
  return cost;
}

/**
 * Solve one preset shape into an ordered list of 15 pick ids. Greedy with a
 * feasibility guard: fill the greediest slots first (while budget and club
 * headroom are freshest), and for each slot only consider picks that still leave
 * enough budget to complete the rest. Feasibility is monotone in price (a cheaper
 * pick is always at least as completable), so we take the greed-target pick or
 * the most expensive one that still fits.
 *
 * `anchorIds` are must-have players the manager picked first: they are placed
 * before any greedy fill and always survive, so the same anchors carry across a
 * flip from one shape to another. An anchor consumes its position's top greed
 * slot (a must-have is treated as the premium pick for that line). If the anchors
 * are so expensive the squad can't complete, we fall back to a cheapest-legal
 * fill that STILL keeps them — the caller checks length to detect the rare case
 * where even that overspends.
 */
export function solvePreset(
  shape: PresetShape,
  pool: PresetPlayer[],
  budgetTenths = BUDGET_TENTHS,
  anchorIds: number[] = [],
): number[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const ascByPos = {} as Record<FantasyPos, PresetPlayer[]>;
  for (const pos of POSITIONS) {
    ascByPos[pos] = pool.filter((p) => p.pos === pos).sort((a, b) => a.priceTenths - b.priceTenths);
  }

  const need: Record<FantasyPos, number> = { ...SQUAD_QUOTA };
  const used = new Set<number>();
  const clubCount = new Map<number, number>();
  const picks: number[] = [];
  let budget = budgetTenths;

  // Place the must-haves first — they anchor the squad and survive a flip.
  const anchoredByPos: Record<FantasyPos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of anchorIds) {
    const p = byId.get(id);
    if (!p || used.has(id)) continue;
    if (need[p.pos] <= 0) continue;                                  // that line is already full of anchors
    if ((clubCount.get(p.clubId) ?? 0) >= MAX_PER_CLUB) continue;    // 3-per-club cap
    picks.push(id); used.add(id); budget -= p.priceTenths;
    need[p.pos]--; anchoredByPos[p.pos]++;
    clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
  }

  // Remaining slots = the shape's greed list per position, minus the top slots
  // the anchors took (a must-have stands in for that line's premium pick).
  const slots = POSITIONS.flatMap((pos) =>
    [...shape.greed[pos]].sort((a, b) => b - a).slice(anchoredByPos[pos]).map((greed) => ({ pos, greed })),
  ).sort((a, b) => b.greed - a.greed);

  for (const slot of slots) {
    need[slot.pos]--; // this slot is being filled now
    // Candidates for this slot, cheapest-first so the feasible set is a prefix.
    const cand = ascByPos[slot.pos].filter(
      (p) => !used.has(p.id) && (clubCount.get(p.clubId) ?? 0) < MAX_PER_CLUB,
    );
    // Keep only picks that still leave the rest of the squad affordable.
    const feasible = cand.filter((p) => {
      used.add(p.id);
      const rest = minRemainingCost(need, ascByPos, used);
      used.delete(p.id);
      return budget - p.priceTenths >= rest;
    });
    if (feasible.length === 0) return cheapestLegal(pool, budgetTenths, anchorIds); // can't complete this shape
    // feasible is cheapest-first; greed picks how far up the price ladder to go.
    const idx = Math.min(feasible.length - 1, Math.round(slot.greed * (feasible.length - 1)));
    const choice = feasible[idx];
    picks.push(choice.id);
    used.add(choice.id);
    budget -= choice.priceTenths;
    clubCount.set(choice.clubId, (clubCount.get(choice.clubId) ?? 0) + 1);
  }
  return picks;
}

/** Last-resort valid squad: the anchors (if any) plus a cheapest legal fill of
 *  the rest. Never leaves the user stuck, and never drops a must-have. */
function cheapestLegal(pool: PresetPlayer[], budgetTenths: number, anchorIds: number[] = []): number[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const picks: number[] = [];
  const clubCount = new Map<number, number>();
  const takenByPos: Record<FantasyPos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  let budget = budgetTenths;
  const used = new Set<number>();

  for (const id of anchorIds) {
    const p = byId.get(id);
    if (!p || used.has(id) || takenByPos[p.pos] >= SQUAD_QUOTA[p.pos]) continue;
    if ((clubCount.get(p.clubId) ?? 0) >= MAX_PER_CLUB) continue;
    picks.push(id); used.add(id); budget -= p.priceTenths;
    takenByPos[p.pos]++; clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
  }

  for (const pos of POSITIONS) {
    const avail = pool.filter((p) => p.pos === pos).sort((a, b) => a.priceTenths - b.priceTenths);
    for (const p of avail) {
      if (takenByPos[pos] === SQUAD_QUOTA[pos]) break;
      if (used.has(p.id)) continue;
      if ((clubCount.get(p.clubId) ?? 0) >= MAX_PER_CLUB) continue;
      if (p.priceTenths > budget) continue;
      picks.push(p.id); used.add(p.id);
      clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
      budget -= p.priceTenths;
      takenByPos[pos]++;
    }
  }
  return picks;
}

/**
 * Build a preset and hand back its pick ids, validated against the real engine
 * rules. Throws only if even the cheapest legal squad can't be formed (an
 * unusably thin pool) — callers show that as "presets unavailable".
 */
export function buildPreset(shape: PresetShape, pool: PoolPlayer[]): number[] {
  const ids = solvePreset(shape, pool);
  validateSquad(ids, pool); // guard: real rules, real prices — throws if illegal
  return ids;
}

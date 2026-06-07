/**
 * Draft XI — scoring engine. THE WHOLE GAME.
 *
 * Pure + deterministic (except where an explicit RNG is passed). Server-side
 * authoritative: the API recomputes Strength + projection from the squad on every
 * save/match and ignores any client-sent rating.
 *
 * Pipeline:
 *   scoreTeam(squad, formation) -> Strength Rating (~40-99)
 *     = weighted mean of (overall x positionalFit) over the 11 slots,
 *       spine slots weighted heavier, minus shape/GK penalties, plus capped chemistry.
 *   projectSeason(strength) -> deterministic 38-game projection + tier.
 *   winProbability(a, b) / resolveH2H(a, b, rng) -> single-game H2H result.
 *
 * Type-strippable (no enums) so it runs under `node --test`.
 */

import type { Formation, PlacedPlayer, Position, Projected, Tier } from "./types";
import { slotsFor } from "./formations";

// ─── Positional fit ──────────────────────────────────────────────────────────

/** Fit multipliers by tier (locked design decision). */
export const FIT_EXACT = 1.0;
export const FIT_ADJACENT = 0.92;
export const FIT_LOOSE = 0.8;
export const FIT_WRONG = 0.55;

/**
 * For each slot position, which player positions cover it at each tier.
 * Anything not listed is "wrong" (0.55). GK is intentionally strict: only a GK
 * fits a GK slot, and a GK in any outfield slot is wrong.
 */
const COVER: Record<Position, { adjacent: Position[]; loose: Position[] }> = {
  GK:  { adjacent: [],            loose: [] },
  RB:  { adjacent: ["RWB"],       loose: ["CB", "RW", "CM"] },
  LB:  { adjacent: ["LWB"],       loose: ["CB", "LW", "CM"] },
  CB:  { adjacent: ["CDM"],       loose: ["RB", "LB"] },
  RWB: { adjacent: ["RB", "RW"],  loose: ["LWB", "CM"] },
  LWB: { adjacent: ["LB", "LW"],  loose: ["RWB", "CM"] },
  CDM: { adjacent: ["CM"],        loose: ["CB", "CAM"] },
  CM:  { adjacent: ["CDM", "CAM"],loose: ["RW", "LW"] },
  CAM: { adjacent: ["CM"],        loose: ["CDM", "RW", "LW", "ST"] },
  RW:  { adjacent: ["LW", "CAM"], loose: ["RWB", "RB", "ST", "CM"] },
  LW:  { adjacent: ["RW", "CAM"], loose: ["LWB", "LB", "ST", "CM"] },
  ST:  { adjacent: ["CAM"],       loose: ["RW", "LW"] },
};

export function fitMultiplier(playerPos: Position, slotPos: Position): number {
  if (playerPos === slotPos) return FIT_EXACT;
  // A GK is useless anywhere but in goal; a non-GK is useless in goal.
  if (playerPos === "GK" || slotPos === "GK") return FIT_WRONG;
  const cover = COVER[slotPos];
  if (cover.adjacent.includes(playerPos)) return FIT_ADJACENT;
  if (cover.loose.includes(playerPos)) return FIT_LOOSE;
  return FIT_WRONG;
}

/** Whether a player can legally be drafted into a slot (anything but "wrong"). */
export function canPlay(playerPos: Position, slotPos: Position): boolean {
  return fitMultiplier(playerPos, slotPos) > FIT_WRONG;
}

// ─── Position categories, colours & line ratings ─────────────────────────────

export type PosCategory = "gk" | "def" | "mid" | "att";

/** Broad category for a position — drives badge colour and the line breakdown. */
export function posCategory(p: Position): PosCategory {
  if (p === "GK") return "gk";
  if (p === "RB" || p === "CB" || p === "LB" || p === "RWB" || p === "LWB") return "def";
  if (p === "CDM" || p === "CM" || p === "CAM") return "mid";
  return "att"; // RW, LW, ST
}

export const CATEGORY_COLOR: Record<PosCategory, string> = {
  gk: "#ffb800",
  def: "#4fc3f7",
  mid: "#00ff87",
  att: "#ff4757",
};

export type LineRatings = { attack: number; midfield: number; defence: number; gk: number };

/** Average overall per line (by each player's SLOT position), 0 if a line is empty.
 *  Powers the live Attack/Midfield/Defence/GK breakdown while drafting. */
export function lineRatings(squad: PlacedPlayer[]): LineRatings {
  const sum: Record<PosCategory, number> = { gk: 0, def: 0, mid: 0, att: 0 };
  const n: Record<PosCategory, number> = { gk: 0, def: 0, mid: 0, att: 0 };
  for (const p of squad) {
    const c = posCategory(p.slotPos);
    sum[c] += p.overall;
    n[c] += 1;
  }
  const avg = (c: PosCategory) => (n[c] ? Math.round(sum[c] / n[c]) : 0);
  return { attack: avg("att"), midfield: avg("mid"), defence: avg("def"), gk: avg("gk") };
}

// ─── Spine weighting ─────────────────────────────────────────────────────────

/** Central spine (GK, CBs, central mids, ST) matters more than wide slots. */
export function spineWeight(slotPos: Position): number {
  switch (slotPos) {
    case "GK": return 1.2;
    case "CB": return 1.1;
    case "CDM": return 1.1;
    case "CM": return 1.08;
    case "ST": return 1.15;
    case "CAM": return 1.05;
    case "RB": case "LB": return 0.95;
    case "RWB": case "LWB": return 0.92;
    case "RW": case "LW": return 0.95;
  }
}

// ─── Balance / shape ─────────────────────────────────────────────────────────

function hasGoalkeeper(squad: PlacedPlayer[]): boolean {
  return squad.some((p) => p.slotPos === "GK" && p.position === "GK");
}

/**
 * Penalty for fielding players badly out of position. Fit already discounts each
 * player; this is an extra, escalating team-level penalty so an XI stuffed with
 * square pegs is punished beyond the per-player hit. Capped.
 */
export function shapeImbalancePenalty(squad: PlacedPlayer[]): number {
  const wrong = squad.filter(
    (p) => fitMultiplier(p.position, p.slotPos) <= FIT_WRONG && p.slotPos !== "GK"
  ).length;
  return Math.min(wrong * 2.2, 12);
}

// ─── Chemistry (capped) ──────────────────────────────────────────────────────

/**
 * Small bonus for same-club links (a real spine of clubmates). Same club+season
 * links count double. Capped at +6 so chemistry flavours but never decides a team.
 */
export function chemistry(squad: PlacedPlayer[]): number {
  const byClub = new Map<string, number>();
  const byClubSeason = new Map<string, number>();
  for (const p of squad) {
    byClub.set(p.club, (byClub.get(p.club) ?? 0) + 1);
    const key = `${p.club}__${p.season}`;
    byClubSeason.set(key, (byClubSeason.get(key) ?? 0) + 1);
  }
  let bonus = 0;
  for (const n of Array.from(byClub.values())) if (n >= 2) bonus += (n - 1) * 0.7;
  for (const n of Array.from(byClubSeason.values())) if (n >= 2) bonus += (n - 1) * 0.6;
  return Math.min(bonus, 6);
}

// ─── Strength Rating ─────────────────────────────────────────────────────────

/**
 * Strength Rating for a complete (or partial) XI. Weighted mean of overall x fit
 * across filled slots, minus penalties, plus chemistry. ~40-99.
 *
 * Robust to a partial squad (used for the live preview during drafting): only
 * filled slots contribute, and the GK penalty only bites once a GK slot is filled
 * by a non-GK (an empty GK slot is "not yet", not "broken").
 */
export function scoreTeam(squad: PlacedPlayer[], formation: Formation): number {
  if (squad.length === 0) return 0;
  const slots = slotsFor(formation);
  const gkSlotFilled = squad.some((p) => p.slotPos === "GK");

  let weighted = 0;
  let weightSum = 0;
  for (const p of squad) {
    const fit = fitMultiplier(p.position, p.slotPos);
    const w = spineWeight(p.slotPos);
    weighted += p.overall * fit * w;
    weightSum += w;
  }
  let strength = weightSum > 0 ? weighted / weightSum : 0;

  // Penalties only meaningful once relevant slots exist.
  if (gkSlotFilled && !hasGoalkeeper(squad)) strength -= 8;
  strength -= (squad.length / slots.length) * shapeImbalancePenalty(squad);

  // Chemistry on the full XI only (partial chemistry would be misleading).
  if (squad.length === slots.length) strength += chemistry(squad);

  return Math.round(clamp(strength, 0, 99) * 10) / 10;
}

// ─── Season projection ───────────────────────────────────────────────────────

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Deterministic 38-game projection. Tuned so only a near-perfect XI
 * (Strength ~96+) can reach 38-0 Invincible — which random spins make rare
 * (~1 in 200 well-drafted teams), exactly as intended.
 */
export function projectSeason(strength: number): Projected {
  const t = clamp((strength - 58) / 38, 0, 1);
  const winPct = Math.pow(t, 1.5) * 0.99;     // asymptotic; 38-0 only at the very top
  const wins = Math.round(38 * winPct);
  const losses = Math.round((38 - wins) * (1 - t) * 0.6);
  const draws = 38 - wins - losses;
  const points = wins * 3 + draws;
  return {
    wins,
    draws,
    losses,
    points,
    position: tableSlot(points),
    tier: tierFor(points),
  };
}

/** Projected league finish (1-20) from points. Monotonic, broadcast-plausible. */
export function tableSlot(points: number): number {
  if (points >= 100) return 1;
  if (points >= 90) return 1;
  if (points >= 84) return 2;
  if (points >= 78) return 3;
  if (points >= 72) return 4;
  if (points >= 67) return 5;
  if (points >= 62) return 6;
  if (points >= 57) return 8;
  if (points >= 52) return 10;
  if (points >= 47) return 12;
  if (points >= 42) return 14;
  if (points >= 37) return 16;
  if (points >= 32) return 18;
  return 20;
}

export function tierFor(points: number): Tier {
  if (points >= 114) return "INVINCIBLE";
  if (points >= 100) return "Centurions";
  if (points >= 90) return "Champions";
  if (points >= 75) return "Title Challengers";
  if (points >= 60) return "Europe";
  if (points >= 45) return "Mid-table";
  if (points >= 30) return "Relegation Battle";
  return "Relegated";
}

// ─── H2H resolution ──────────────────────────────────────────────────────────

/**
 * Probability team A beats team B given both Strength Ratings. Logistic curve;
 * the divisor sets the upset rate — smaller = more deterministic. At 8, a 6-point
 * Strength edge is ~85/15, a 2-point edge ~64/36: the stronger team usually wins
 * but upsets are frequent enough to stay dramatic.
 */
export function winProbability(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 8));
}

/** Single-game H2H. Pass a seeded RNG server-side for reproducible results. */
export function resolveH2H(a: number, b: number, rng: () => number = Math.random): "A" | "B" {
  return rng() < winProbability(a, b) ? "A" : "B";
}

/**
 * Deterministic RNG from a string seed (e.g. a match id). Lets the server resolve
 * an H2H reproducibly and audit-ably instead of relying on Math.random.
 */
export function seededRng(seed: string): () => number {
  // xmur3 hash -> mulberry32 PRNG.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

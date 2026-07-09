/**
 * Your PL XI warm-up — the ECONOMY in one file: grants, prices, and squad deals.
 * Pure and client-safe; imported by the page AND by scripts/gates/measure.mjs so
 * balance measurements run the exact game code (no estimate drift). All tuning
 * dials live here.
 */

import { spin } from "../draft/pool";
import { canPlay, playerIdentity, seededRng } from "../draft/score";
import type { PlayerSeason, Position } from "../draft/types";
import { priceOf } from "./warmup-economy";

export { grantFor, overallFromPrice, priceOf, r10 } from "./warmup-economy";

/** Map a granular formation slot ("RB", "CM", "ST"…) to a position bucket —
 *  the 26/27 player feed only knows GK/DEF/MID/FWD. */
export function slotBucket(pos: string): "GK" | "DEF" | "MID" | "FWD" {
  if (pos === "GK") return "GK";
  if (["RB", "LB", "CB", "RWB", "LWB", "DEF"].includes(pos)) return "DEF";
  if (["CM", "CDM", "CAM", "RM", "LM", "MID"].includes(pos)) return "MID";
  return "FWD";
}

// ── Deals ─────────────────────────────────────────────────────────────────────
export type CurrentPlayer = {
  id: number;
  name: string;
  club: string;
  clubId: number;
  position: string;
  price: number;
};
export type SlotSquad = { club: string; season: string; players: PlayerSeason[] };

// ── 26/27 ratings: price → rating WITHIN the position ────────────────────────
// FPL prices are position-skewed by design (elite GK ≈ £6, elite FWD ≈ £15), so
// a single global price→rating curve caps keepers/defenders at ~75 and made an
// elite spine impossible (measured). Rating = price percentile inside the
// position bucket, mapped to that position's realistic top rating. The price
// the user PAYS stays the player's REAL value — same player, same price,
// everywhere (founder's consistency rule).
const BUCKET_TOP: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  GK: 87,
  DEF: 88,
  MID: 91,
  FWD: 92,
};
const RATING_FLOOR = 55;
const RATING_GAMMA = 1.35; // >1: stars stand out, the mid-pack stays honest

/** Build a rating fn for the current-player feed (percentile-in-bucket based). */
export function ratingFromPriceByBucket(
  players: readonly CurrentPlayer[],
): (p: CurrentPlayer) => number {
  const sorted: Record<string, number[]> = {};
  for (const bucket of ["GK", "DEF", "MID", "FWD"]) {
    sorted[bucket] = players
      .filter((p) => p.position === bucket)
      .map((p) => p.price)
      .sort((a, b) => a - b);
  }
  return (p: CurrentPlayer) => {
    const prices = sorted[p.position] ?? [];
    if (prices.length < 2) return 70;
    let below = 0;
    for (const x of prices) if (x < p.price) below++;
    const pct = below / (prices.length - 1);
    const top = BUCKET_TOP[p.position as keyof typeof BUCKET_TOP] ?? 90;
    return Math.round(RATING_FLOOR + Math.pow(pct, RATING_GAMMA) * (top - RATING_FLOOR));
  };
}

/** The £m price to PAY for a drafted player: 26/27 players carry their real
 *  value (stashed at deal time); all-era legends price off the rating curve. */
export function playerPrice(p: PlayerSeason): number {
  const real = (p as unknown as { priceM?: number }).priceM;
  return typeof real === "number" ? real : priceOf(p.overall);
}

/** How strongly a hot streak pulls big clubs into the deal (per streak step).
 *  Measured: 0.9 was too weak — perfect players still saw mostly mid clubs and
 *  banked £35m they couldn't spend. */
export const STREAK_CLUB_PULL = 3.0;

/** 26/27 mode: deal a CURRENT club's squad for the slot — players priced by
 *  their real value, sim rating derived from the price.
 *
 *  A LIVE STREAK weights the deal toward bigger clubs (by total squad value):
 *  get hot and the City/Liverpool/Arsenal squads start appearing — the elite
 *  become AVAILABLE; the budget still decides whether you can afford them. */
export function dealCurrentSquad(
  players: readonly CurrentPlayer[],
  slotPos: Position,
  usedIds: Set<string>,
  usedIdents: Set<string>,
  budget: number,
  seedStr: string,
  streak = 0,
): SlotSquad {
  const rng = seededRng(seedStr);
  const bucket = slotBucket(slotPos as string);
  // Club quality = the average of the club's TOP-5 player prices (total squad
  // value rewards big rosters, not big clubs — measured), normalized 0..1.
  const pricesByClub = new Map<string, number[]>();
  for (const p of players) {
    const arr = pricesByClub.get(p.club);
    if (arr) arr.push(p.price);
    else pricesByClub.set(p.club, [p.price]);
  }
  const top5ByClub = new Map<string, number>();
  pricesByClub.forEach((prices, club) => {
    const top = prices.sort((a, b) => b - a).slice(0, 5);
    top5ByClub.set(club, top.reduce((a, b) => a + b, 0) / top.length);
  });
  const values = Array.from(top5ByClub.values());
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const quality = (club: string) => (maxV === minV ? 0 : ((top5ByClub.get(club) ?? minV) - minV) / (maxV - minV));
  // Weighted shuffle (seeded): weight 1 for everyone, plus a streak-scaled pull
  // toward quality. Streak 0 = uniform (identical to the old shuffle in law).
  const pull = Math.min(6, Math.max(0, streak)) * STREAK_CLUB_PULL;
  const clubs = Array.from(new Set(players.map((p) => p.club)))
    .map((club) => ({ club, key: -Math.log(Math.max(rng(), 1e-9)) / (1 + pull * quality(club)) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.club);
  const rating = ratingFromPriceByBucket(players);
  const toSeason = (list: CurrentPlayer[]): PlayerSeason[] =>
    list
      .map(
        (p) =>
          ({
            id: `cur-${p.id}`,
            name: p.name,
            club: p.club,
            season: "2026/27",
            position: slotPos, // auto-fit: bucket data has no granular position
            overall: rating(p),
            priceM: p.price, // the REAL price the user pays (see playerPrice)
          }) as unknown as PlayerSeason,
      )
      .sort((a, b) => b.overall - a.overall);
  let best: SlotSquad | null = null;
  for (const club of clubs) {
    const eligible = players.filter(
      (p) =>
        p.club === club &&
        p.position === bucket &&
        !usedIds.has(`cur-${p.id}`) &&
        !usedIdents.has(playerIdentity(p.name)),
    );
    if (eligible.length === 0) continue;
    const squad = { club, season: "2026/27", players: toSeason(eligible) };
    if (!best) best = squad;
    if (eligible.some((p) => p.price <= budget)) return squad;
  }
  return best ?? { club: "", season: "2026/27", players: [] };
}

/** Legends mode: deal a club+season squad from the all-era pool that contains at
 *  least one affordable player (retrying the spin). Requires ensurePool(). */
export function dealSquad(
  slotPos: Position,
  usedIds: Set<string>,
  usedIdents: Set<string>,
  budget: number,
  seedStr: string,
): SlotSquad {
  const rng = seededRng(seedStr);
  const seen = new Set<string>();
  let last: SlotSquad | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const sp = spin([slotPos], usedIds, usedIdents, rng, seen, "PL");
    seen.add(`${sp.club}|${sp.season}`);
    const eligible = sp.players.filter(
      (p) => canPlay(p.position, slotPos) && !usedIds.has(p.id) && !usedIdents.has(playerIdentity(p.name)),
    );
    if (eligible.length === 0) continue;
    const squad: SlotSquad = {
      club: sp.club,
      season: sp.season,
      players: eligible.sort((a, b) => b.overall - a.overall),
    };
    last = squad;
    if (eligible.some((p) => priceOf(p.overall) <= budget)) return squad;
  }
  // Vanishingly rare: nothing affordable in 40 deals — return the last squad;
  // the UI lets the cheapest player go for the full remaining budget.
  return last ?? { club: "", season: "", players: [] };
}

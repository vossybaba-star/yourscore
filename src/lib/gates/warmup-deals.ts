/**
 * Your PL XI warm-up — the ECONOMY in one file: grants, prices, and squad deals.
 * Pure and client-safe; imported by the page AND by scripts/gates/measure.mjs so
 * balance measurements run the exact game code (no estimate drift). All tuning
 * dials live here.
 */

import { spin } from "../draft/pool";
import { canPlay, playerIdentity, seededRng } from "../draft/score";
import type { PlayerSeason, Position } from "../draft/types";
import { overallFromPrice, priceOf } from "./warmup-economy";

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

/** 26/27 mode: deal a CURRENT club's squad for the slot — players priced by
 *  their real value, sim rating derived from the price. */
export function dealCurrentSquad(
  players: readonly CurrentPlayer[],
  slotPos: Position,
  usedIds: Set<string>,
  usedIdents: Set<string>,
  budget: number,
  seedStr: string,
): SlotSquad {
  const rng = seededRng(seedStr);
  const bucket = slotBucket(slotPos as string);
  const clubs = Array.from(new Set(players.map((p) => p.club)));
  for (let i = clubs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [clubs[i], clubs[j]] = [clubs[j], clubs[i]];
  }
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
            overall: overallFromPrice(p.price),
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
    if (eligible.some((p) => priceOf(overallFromPrice(p.price)) <= budget)) return squad;
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

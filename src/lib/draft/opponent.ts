/**
 * Draft XI — auto-drafter. Builds a complete, plausible XI by spinning and
 * drafting greedily. Used for local "Quick Match" opponents now, and as a bot
 * fallback for matchmaking later (when no live human opponent is available).
 */

import type { Formation, PlacedPlayer } from "./types";
import { spin } from "./pool";
import { seededRng } from "./score";
import { emptyTeam, openSlots, bestOpenSlot, placePlayer, isComplete, usedPlayerIds, usedPlayerNames, type LocalTeam } from "./local";

const OPPONENT_NAMES = [
  "The Gaffer", "Pub Team FC", "Sunday League XI", "Wenger's Ghost", "Group Chat United",
  "Bantersaurus", "Tactico", "Zonal Marking", "The Spreadsheet", "Big Sam's Boys",
  "Route One Rovers", "xG Merchants", "Bottlejob FC", "Vibes Only", "The Treble Seekers",
];

export type Opponent = { name: string; team: LocalTeam };

/** Auto-draft a full XI in the given formation. */
export function autoDraft(formation: Formation, rng: () => number = Math.random): LocalTeam {
  let team = emptyTeam(formation);
  let guard = 0;
  while (!isComplete(team) && guard++ < 200) {
    const open = openSlots(team).map((s) => s.pos);
    const s = spin(open, usedPlayerIds(team), usedPlayerNames(team), rng);
    // pick the player that fills the heaviest-need slot best (greedy by overall x fit)
    let bestPlayer = null as null | (typeof s.players)[number];
    let bestSlotId = null as null | string;
    let bestScore = -1;
    for (const p of s.players) {
      const slot = bestOpenSlot(team, p);
      if (!slot) continue;
      const score = p.overall + (p.position === slot.pos ? 6 : 0);
      if (score > bestScore) { bestScore = score; bestPlayer = p; bestSlotId = slot.id; }
    }
    if (bestPlayer && bestSlotId) {
      const slot = openSlots(team).find((x) => x.id === bestSlotId)!;
      team = placePlayer(team, bestPlayer, slot);
    }
  }
  return team;
}

/** A named opponent of roughly comparable strength to the player (for fair-ish
 *  quick matches): try a few auto-drafts, keep the one closest to target. */
export function makeOpponent(formation: Formation, targetStrength: number, rng: () => number = Math.random): Opponent {
  let best: LocalTeam | null = null;
  for (let i = 0; i < 4; i++) {
    const t = autoDraft(formation, rng);
    if (!best || Math.abs(t.strength - targetStrength) < Math.abs(best.strength - targetStrength)) best = t;
  }
  const name = OPPONENT_NAMES[Math.floor(rng() * OPPONENT_NAMES.length)];
  return { name, team: best! };
}

/** A fully deterministic bot from a string seed — so the opponent previewed before
 *  a match is exactly the one resolved against (the seed is fixed at matchmaking). */
export function seededBot(formation: Formation, seed: string): Opponent {
  const rng = seededRng(seed);
  const team = autoDraft(formation, rng);
  const name = OPPONENT_NAMES[Math.floor(rng() * OPPONENT_NAMES.length)];
  return { name, team };
}

export type { PlacedPlayer };

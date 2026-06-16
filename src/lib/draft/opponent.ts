/**
 * Draft XI — auto-drafter. Builds a complete, plausible XI by spinning and
 * drafting greedily. Used for local "Quick Match" opponents now, and as a bot
 * fallback for matchmaking later (when no live human opponent is available).
 */

import type { Formation, League, PlacedPlayer } from "./types";
import { spin, spinWorld } from "./pool";
import { seededRng } from "./score";
import { emptyTeam, openSlots, bestOpenSlot, placePlayer, isComplete, usedPlayerIds, usedPlayerNames, type LocalTeam } from "./local";

const OPPONENT_NAMES = [
  "The Gaffer", "Pub Team FC", "Sunday League XI", "Wenger's Ghost", "Group Chat United",
  "Bantersaurus", "Tactico", "Zonal Marking", "The Spreadsheet", "Big Sam's Boys",
  "Route One Rovers", "xG Merchants", "Bottlejob FC", "Vibes Only", "The Treble Seekers",
];

// Believable gamer-handles for *ranked live* bot opponents — they must read as
// real users (the jokey OPPONENT_NAMES above stay for explicit practice/Quick
// Match). Deliberately "messy" like real handles: mixed case, numbers, separators,
// football refs — so they don't look auto-generated. Seeded → stable per match.
const HANDLE_FIRST = [
  "jack", "leah", "danny", "tom", "aisha", "marco", "liam", "sofia", "kai", "noah",
  "ella", "reece", "yusuf", "owen", "maya", "harry", "amara", "finn", "zara", "luca",
  "callum", "nina", "raheem", "beth", "ade", "sam", "priya", "george", "mia", "josh",
  "deano", "kez", "bilal", "tyrone", "shay", "rico", "macca", "jonjo", "dec", "kemi",
];
const HANDLE_WORD = [
  "fc", "utd", "afc", "cfc", "ynwa", "coys", "ldn", "xi", "baller", "gooner",
  "toon", "hammer", "ftbl", "10", "ultra", "og", "tekkers", "boro", "saint",
];
const HANDLE_TAG = [
  "Gegenpress", "TikiTaka", "RouteOne", "FalseNine", "LowBlock", "xGmerchant",
  "TackleKing", "NutmegGod", "ParkTheBus", "WingPlay", "BoxToBox", "OffsideTrap",
  "ScreamerFC", "TopBins", "ThirdRound",
];
const HANDLE_NUM = ["7", "07", "9", "10", "99", "21", "98", "00", "11", "23", "45", "04", "88", "17", "06", "92"];

const pickFrom = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A believable, deliberately-irregular username from a seed (e.g. a match id) —
 *  for disguised ranked bots. ~12 handle shapes so two bots rarely look alike. */
export function realisticOpponentName(seed: string): string {
  const rng = seededRng(seed);
  const f = pickFrom(rng, HANDLE_FIRST);
  const w = pickFrom(rng, HANDLE_WORD);
  const n = pickFrom(rng, HANDLE_NUM);
  const tag = pickFrom(rng, HANDLE_TAG);
  switch (Math.floor(rng() * 12)) {
    case 0:  return `${f}${n}`;               // jack07
    case 1:  return `${f}_${w}`;              // leah_fc
    case 2:  return `${f}${w}${n}`;           // harryutd21
    case 3:  return `x_${f}_x`;               // x_kai_x
    case 4:  return `${cap(f)}${n}`;          // Mason99
    case 5:  return `the${cap(f)}`;           // theOwen
    case 6:  return `${f}.${w}`;              // zara.afc
    case 7:  return `${cap(f)}_${cap(w)}`;    // Reece_Utd
    case 8:  return `${tag}${n}`;             // Gegenpress10
    case 9:  return `${tag}_${cap(f)}`;       // TopBins_Sam
    case 10: return `${f}__${n}`;             // danny__23
    default: return `${cap(tag)}`;            // RouteOne
  }
}

export type Opponent = { name: string; team: LocalTeam };

/** Auto-draft a full XI in the given formation, from `league`'s pool. */
export function autoDraft(formation: Formation, rng: () => number = Math.random, league: League = "PL"): LocalTeam {
  let team = emptyTeam(formation, "classic", league);
  let guard = 0;
  while (!isComplete(team) && guard++ < 200) {
    const open = openSlots(team).map((s) => s.pos);
    const s = spin(open, usedPlayerIds(team), usedPlayerNames(team), rng, new Set(), league);
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
export function makeOpponent(formation: Formation, targetStrength: number, rng: () => number = Math.random, league: League = "PL"): Opponent {
  let best: LocalTeam | null = null;
  for (let i = 0; i < 4; i++) {
    const t = autoDraft(formation, rng, league);
    if (!best || Math.abs(t.strength - targetStrength) < Math.abs(best.strength - targetStrength)) best = t;
  }
  const name = OPPONENT_NAMES[Math.floor(rng() * OPPONENT_NAMES.length)];
  return { name, team: best! };
}

/** A fully deterministic bot from a string seed — so the opponent previewed before
 *  a match is exactly the one resolved against (the seed is fixed at matchmaking). */
export function seededBot(formation: Formation, seed: string, league: League = "PL"): Opponent {
  const rng = seededRng(seed);
  const team = autoDraft(formation, rng, league);
  const name = OPPONENT_NAMES[Math.floor(rng() * OPPONENT_NAMES.length)];
  return { name, team };
}

/** Auto-draft a full XI from the open World Cup pool: each spin lands on ONE WC 2026
 *  nation and offers its players, so a greedy fill mixes nations into a World XI —
 *  exactly the squad type a human builds in the open World Cup draft. The team's
 *  `league` field is a placeholder ("PL"); its players come from `spinWorld`, not a
 *  league pool, so it's never re-spun by league. */
export function autoDraftWorld(formation: Formation, rng: () => number = Math.random): LocalTeam {
  let team = emptyTeam(formation, "classic", "PL");
  let guard = 0;
  while (!isComplete(team) && guard++ < 200) {
    const open = openSlots(team).map((s) => s.pos);
    const s = spinWorld(open, usedPlayerIds(team), usedPlayerNames(team), {}, rng);
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

/** Deterministic World Cup bot opponent (open-pool XI), seeded for preview/replay parity. */
export function seededWorldBot(formation: Formation, seed: string): Opponent {
  const rng = seededRng(seed);
  const team = autoDraftWorld(formation, rng);
  const name = OPPONENT_NAMES[Math.floor(rng() * OPPONENT_NAMES.length)];
  return { name, team };
}

export type { PlacedPlayer };

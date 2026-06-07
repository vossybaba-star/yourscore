/**
 * Draft XI — client-side team state + local persistence.
 *
 * Anonymous play is core (login is only needed to save to the cloud & challenge),
 * so the current XI lives in localStorage. The server remains authoritative for
 * anything competitive: on save/challenge the API recomputes Strength + projection
 * from the squad and ignores these client values.
 */

import type { Formation, PlacedPlayer, PlayerSeason, Projected, Slot, TeamStatus } from "./types";
import { slotsFor } from "./formations";
import { fitMultiplier, scoreTeam, projectSeason, spineWeight } from "./score";

const STORAGE_KEY = "draftxi:team:v1";

/** Classic shows overalls while drafting; Expert hides them (names + positions
 *  only) until the XI is complete — draft on football knowledge, big reveal at the
 *  end. The signature 38-0 "for real fans" mode. */
export type DraftMode = "classic" | "expert";

export type LocalTeam = {
  formation: Formation;
  mode: DraftMode;
  squad: PlacedPlayer[];
  status: TeamStatus;
  winStreak: number;
  /** A win grants exactly one swap (re-spin one slot). Consumed when used. */
  swapAvailable: boolean;
  strength: number;
  projected: Projected | null;
  updatedAt: number;
};

export function emptyTeam(formation: Formation, mode: DraftMode = "classic"): LocalTeam {
  return {
    formation,
    mode,
    squad: [],
    status: "active",
    winStreak: 0,
    swapAvailable: false,
    strength: 0,
    projected: null,
    updatedAt: Date.now(),
  };
}

/** Post-win: streak up, one swap unlocked, stays active & challengeable. */
export function recordWin(team: LocalTeam): LocalTeam {
  return { ...team, winStreak: team.winStreak + 1, swapAvailable: true, status: "active", updatedAt: Date.now() };
}

/** Post-loss: team goes stale (must rebuild a full XI before it can play again). */
export function recordLoss(team: LocalTeam): LocalTeam {
  return { ...team, winStreak: 0, swapAvailable: false, status: "stale", updatedAt: Date.now() };
}

/** Slots in this formation not yet filled. */
export function openSlots(team: LocalTeam): Slot[] {
  const filled = new Set(team.squad.map((p) => p.slot));
  return slotsFor(team.formation).filter((s) => !filled.has(s.id));
}

export function isComplete(team: LocalTeam): boolean {
  return team.squad.length === slotsFor(team.formation).length;
}

export function usedPlayerIds(team: LocalTeam): Set<string> {
  return new Set(team.squad.map((p) => p.player_season_id));
}

/** Names already in the XI — used to stop the same player being drafted twice,
 *  even from a different club/season. */
export function usedPlayerNames(team: LocalTeam): Set<string> {
  return new Set(team.squad.map((p) => p.name));
}

/**
 * Best open slot a player can legally fill: highest positional fit, then heaviest
 * spine weight (so a CB goes to a CB slot before covering full-back). null if the
 * player fits no open slot.
 */
export function bestOpenSlot(team: LocalTeam, player: PlayerSeason): Slot | null {
  let best: Slot | null = null;
  let bestScore = -1;
  for (const s of openSlots(team)) {
    const fit = fitMultiplier(player.position, s.pos);
    if (fit <= 0.55) continue; // not a legal fit (canPlay === false)
    const score = fit * 100 + spineWeight(s.pos);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** All open slots a player could legally fill (for "choose a slot" UIs). */
export function fittingOpenSlots(team: LocalTeam, player: PlayerSeason): Slot[] {
  return openSlots(team).filter((s) => fitMultiplier(player.position, s.pos) > 0.55);
}

/** Place a player into a slot, recompute, and return a new team. */
export function placePlayer(team: LocalTeam, player: PlayerSeason, slot: Slot): LocalTeam {
  const squad: PlacedPlayer[] = [
    ...team.squad.filter((p) => p.slot !== slot.id),
    {
      slot: slot.id,
      slotPos: slot.pos,
      player_season_id: player.id,
      name: player.name,
      club: player.club,
      season: player.season,
      overall: player.overall,
      position: player.position,
    },
  ];
  return recompute({ ...team, squad });
}

/** Remove a player from a slot (used by swap). */
export function clearSlot(team: LocalTeam, slotId: string): LocalTeam {
  return recompute({ ...team, squad: team.squad.filter((p) => p.slot !== slotId) });
}

/** Recompute Strength + projection from the current squad. */
export function recompute(team: LocalTeam): LocalTeam {
  const strength = scoreTeam(team.squad, team.formation);
  const projected = isComplete(team) ? projectSeason(strength) : null;
  return { ...team, strength, projected, updatedAt: Date.now() };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function saveTeam(team: LocalTeam): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
  } catch {
    /* storage unavailable (private mode) — game still playable in-memory */
  }
}

export function loadTeam(): LocalTeam | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as LocalTeam;
    if (!t.formation || !Array.isArray(t.squad)) return null;
    if (t.mode !== "expert") t.mode = "classic";
    return recompute(t);
  } catch {
    return null;
  }
}

export function clearTeam(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Last match (for the result + share screen) ──────────────────────────────

const MATCH_KEY = "draftxi:lastmatch:v1";

export type MatchSide = {
  name: string;
  formation: Formation;
  squad: PlacedPlayer[];
  strength: number;
  projected: Projected | null;
};

export type LocalMatch = {
  id: string;
  you: MatchSide;
  opp: MatchSide;
  winner: "you" | "opp";
  margin: number;
  playedAt: number;
};

export function saveLastMatch(m: LocalMatch): void {
  try { localStorage.setItem(MATCH_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

export function loadLastMatch(): LocalMatch | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    return raw ? (JSON.parse(raw) as LocalMatch) : null;
  } catch {
    return null;
  }
}

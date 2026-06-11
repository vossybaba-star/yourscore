/**
 * Draft XI — client-side team state + local persistence.
 *
 * Anonymous play is core (login is only needed to save to the cloud & challenge),
 * so the current XI lives in localStorage. The server remains authoritative for
 * anything competitive: on save/challenge the API recomputes Strength + projection
 * from the squad and ignores these client values.
 */

import { FORMATIONS, asLeague, type Formation, type League, type PlacedPlayer, type PlayerSeason, type Projected, type Slot, type TeamStatus } from "./types";
import { slotsFor } from "./formations";
import { fitMultiplier, canPlay, posCategory, scoreTeam, projectSeason, spineWeight, playerIdentity, type PosCategory } from "./score";
import { getPlayer } from "./pool";
import type { SeasonResult } from "./season";
import type { MatchReport, MatchSim } from "./live-score";

const STORAGE_KEY = "draftxi:team:v1";

/** Classic shows overalls while drafting; Expert hides them (names + positions
 *  only) until the XI is complete — draft on football knowledge, big reveal at the
 *  end. The signature 38-0 "for real fans" mode. */
export type DraftMode = "classic" | "expert";

export type LocalTeam = {
  /** Which competition this XI is drafted in — drives the spin pool, the league
   *  opponents the season is simulated against, and which leaderboard it counts on.
   *  Defaults to "PL" for teams saved before La Liga shipped. */
  league: League;
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
  /** Set when a team was auto-generated on first join via invite link.
   *  Used to show the post-match "keep or rebuild" prompt. Cleared once the
   *  user makes a choice. */
  autoAssigned?: boolean;
  /** The Supabase user ID that last saved this team to the cloud (via goLive()
   *  or saveToLibrary()). Used on the team page to detect stale cross-account
   *  data: if this is set and doesn't match the signed-in user, the server team
   *  is loaded instead. Undefined means it's a fresh anonymous draft — don't
   *  overwrite it without an explicit mismatch. */
  userId?: string;
};

export function emptyTeam(formation: Formation, mode: DraftMode = "classic", league: League = "PL"): LocalTeam {
  return {
    league,
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

/** Post-win: streak up. The team stays active and keeps playing (no rebuild
 *  penalty — players tweak their XI via the pre-match swap instead). */
export function recordWin(team: LocalTeam): LocalTeam {
  return { ...team, winStreak: team.winStreak + 1, status: "active", updatedAt: Date.now() };
}

/** Post-loss: reset the streak, but the team stays active and challengeable. */
export function recordLoss(team: LocalTeam): LocalTeam {
  return { ...team, winStreak: 0, status: "active", updatedAt: Date.now() };
}

/** Post-draw: a draw breaks a win streak (and grants no swap), but the team stays
 *  active — same as a loss for the loop, just not a defeat. */
export function recordDraw(team: LocalTeam): LocalTeam {
  return { ...team, winStreak: 0, status: "active", updatedAt: Date.now() };
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

/** Canonical identities already in the XI — used to stop the same player being
 *  drafted twice, even from a different edition (where the name string differs). */
export function usedPlayerNames(team: LocalTeam): Set<string> {
  return new Set(team.squad.map((p) => playerIdentity(p.name)));
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
    if (!canPlay(player.position, s.pos)) continue; // must be the same line
    const fit = fitMultiplier(player.position, s.pos);
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
  return openSlots(team).filter((s) => canPlay(player.position, s.pos));
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

// ── Formation switching ──────────────────────────────────────────────────────

/** A formation's line breakdown, e.g. "4-3-3" → "4-3-3" (def-mid-att; GK is always 1). */
function breakdown(f: Formation): string {
  const b: Record<PosCategory, number> = { gk: 0, def: 0, mid: 0, att: 0 };
  for (const s of slotsFor(f)) b[posCategory(s.pos)]++;
  return `${b.def}-${b.mid}-${b.att}`;
}

/** Formations you can switch a built XI into without re-drafting — same number of
 *  defenders, midfielders and attackers, so every player keeps to their own line. */
export function compatibleFormations(f: Formation): Formation[] {
  const key = breakdown(f);
  return FORMATIONS.filter((x) => breakdown(x) === key);
}

/** Re-slot the same 11 players into a new (compatible) formation — each player into
 *  a slot in their own line, natural position first. Strength is recomputed. */
export function reslot(team: LocalTeam, newFormation: Formation): LocalTeam {
  const cats: PosCategory[] = ["gk", "def", "mid", "att"];
  const playersByCat: Record<PosCategory, PlacedPlayer[]> = { gk: [], def: [], mid: [], att: [] };
  for (const p of team.squad) playersByCat[posCategory(p.position)].push(p);
  const slotsByCat: Record<PosCategory, Slot[]> = { gk: [], def: [], mid: [], att: [] };
  for (const s of slotsFor(newFormation)) slotsByCat[posCategory(s.pos)].push(s);

  const squad: PlacedPlayer[] = [];
  for (const cat of cats) {
    const pool = [...playersByCat[cat]];
    for (const s of slotsByCat[cat]) {
      let idx = pool.findIndex((p) => p.position === s.pos); // natural fit first
      if (idx < 0) idx = 0;                                   // else any same-line player
      const p = pool.splice(idx, 1)[0];
      if (!p) continue;
      squad.push({
        slot: s.id, slotPos: s.pos, player_season_id: p.player_season_id,
        name: p.name, club: p.club, season: p.season, overall: p.overall, position: p.position,
      });
    }
  }
  return recompute({ ...team, formation: newFormation, squad });
}

/** Build a playable LocalTeam from a saved library team (formation + squad), so a
 *  user can load one of their saved teams and play with it. */
export function hydrateSavedTeam(formation: Formation, squad: PlacedPlayer[], league: League = "PL"): LocalTeam {
  return recompute({
    league, formation, mode: "classic", squad, status: "active", winStreak: 0,
    swapAvailable: false, strength: 0, projected: null, updatedAt: Date.now(),
  });
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
    // Teams saved before La Liga shipped have no league — default them to PL.
    t.league = asLeague(t.league);
    // "stale" is retired — teams stay playable after a loss. Clear any lingering
    // stale status saved by an older version so it can never block play.
    if (t.status === "stale") t.status = "active";
    // Drop any players whose id no longer exists in the current player database
    // (e.g. a team saved before a data update). This keeps us from ever sending
    // unknown ids to the server — the XI just becomes incomplete and the player
    // is prompted to re-draft the empty slots instead of hitting a cryptic error.
    const known = t.squad.filter((p) => getPlayer(p.player_season_id));
    const cleaned = recompute({ ...t, squad: known });
    if (known.length !== t.squad.length) saveTeam(cleaned); // persist the migration
    return cleaned;
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

// v3: adds the per-half sim so the result flow can play the match out (watch screen).
const MATCH_KEY = "draftxi:lastmatch:v3";

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
  outcome: "you" | "opp" | "draw";
  goals: { you: number; opp: number };
  /** Penalty result if a level 90' was settled by a shootout, else null. */
  pens: { you: number; opp: number } | null;
  /** Full-time report (scorers, assists, ratings, MOTM, stats) — side a = you, b = opp. */
  report: MatchReport;
  /** Per-half sims (side a = you) so the watch screen can play the match out. */
  sim?: MatchSim;
  playedAt: number;
  /** Set when this match was a challenge against a real user (not a bot).
   *  Used to surface the friend suggestion on the result screen. */
  oppUserId?: string;
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

// ── Pending matchup (between "find" and "resolve" — for the pre-match screen) ─

const MATCHUP_KEY = "draftxi:matchup:v1";

export type Matchup = {
  opponentId: string | null;
  findId?: string;
  botFormation?: Formation;
  leagueId?: string | null;
  opp: MatchSide;
};

export function saveMatchup(m: Matchup): void {
  try { localStorage.setItem(MATCHUP_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
export function loadMatchup(): Matchup | null {
  try { const raw = localStorage.getItem(MATCHUP_KEY); return raw ? (JSON.parse(raw) as Matchup) : null; } catch { return null; }
}
export function clearMatchup(): void {
  try { localStorage.removeItem(MATCHUP_KEY); } catch { /* ignore */ }
}

// ── Last simulated season (so returning to a team shows its last result) ─────

const SEASON_KEY = "draftxi:lastseason:v1";

/** Stable seed for the season sim — the squad itself, so the result is the same
 *  every time you view it (and only changes when you change the XI). */
export function seasonSeed(team: LocalTeam): string {
  return team.squad.map((p) => p.player_season_id).sort().join("|");
}

export type StoredSeason = { seed: string; result: SeasonResult; at: number };

export function saveLastSeason(seed: string, result: SeasonResult): void {
  try { localStorage.setItem(SEASON_KEY, JSON.stringify({ seed, result, at: Date.now() })); } catch { /* ignore */ }
}

export function loadLastSeason(): StoredSeason | null {
  try {
    const raw = localStorage.getItem(SEASON_KEY);
    return raw ? (JSON.parse(raw) as StoredSeason) : null;
  } catch {
    return null;
  }
}

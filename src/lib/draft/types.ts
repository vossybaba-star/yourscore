/**
 * Draft XI — shared types.
 *
 * This module is the competitive H2H team-builder game ("Draft XI"), a standalone
 * game inside YourScore separate from the quiz modes. It is ADDITIVE — it does not
 * touch existing YourScore schema, scoring, or routes.
 *
 * Authored to be type-strippable (no enums / namespaces / param-properties) so the
 * scoring engine can run under `node --test` with Node's native type stripping.
 */

/** The football competitions 38-0 is played in. Each is a self-contained pool:
 *  its own spinnable squads, its own league opponents, its own leaderboard. The
 *  World Cup Run mode is separate again (nation-locked, built on the PL pool). */
export type League = "PL" | "LaLiga";

export const LEAGUES: League[] = ["PL", "LaLiga"];

/** Per-league display + flavour strings (copy, country names for the narrative). */
export const LEAGUE_META: Record<League, { name: string; short: string; country: string; demonym: string; accent: string }> = {
  PL: { name: "Premier League", short: "PL", country: "England", demonym: "English", accent: "#00ff87" },
  LaLiga: { name: "La Liga", short: "La Liga", country: "Spain", demonym: "Spanish", accent: "#ff5b2e" },
};

/** Narrow an arbitrary string to a League, falling back to PL. */
export function asLeague(v: string | null | undefined): League {
  return v === "LaLiga" ? "LaLiga" : "PL";
}

/** Canonical playing positions. Dataset + slots both normalise to these. */
export type Position =
  | "GK"
  | "RB" | "CB" | "LB"
  | "RWB" | "LWB"
  | "CDM" | "CM" | "CAM"
  | "RW" | "LW"
  | "ST";

export const POSITIONS: Position[] = [
  "GK", "RB", "CB", "LB", "RWB", "LWB", "CDM", "CM", "CAM", "RW", "LW", "ST",
];

/** The seven supported formations (locked design decision). */
export type Formation =
  | "4-3-3"
  | "4-4-2"
  | "4-2-4"
  | "3-4-3"
  | "3-5-2"
  | "5-3-2"
  | "5-4-1";

export const FORMATIONS: Formation[] = [
  "4-3-3", "4-4-2", "4-2-4", "3-4-3", "3-5-2", "5-3-2", "5-4-1",
];

/** One player-season from the pool (the "card" a spin can deal). */
export type PlayerSeason = {
  id: string;        // `${slug}-${clubSlug}-${seasonSlug}`
  name: string;
  club: string;      // "Liverpool"
  clubSlug: string;  // "liverpool"
  season: string;    // "2016/17"
  position: Position; // canonical
  overall: number;   // 0-99
  nationality?: string; // e.g. "England" — present after the WC-Run dataset rebuild
  league: League;    // "PL" | "LaLiga" — which competition's pool this belongs to
  curated: boolean;
};

/** A nation's entry in the pool's nation index (World Cup Run mode). */
export type NationEntry = {
  nation: string;
  count: number;                                       // player-seasons for this nation
  lines: { GK: number; DEF: number; MID: number; ATT: number }; // distinct players per line
  playable: boolean;                                   // enough depth to field an XI + upgrades
  playerIds: string[];
};

/** A slot in a formation. `pos` is the canonical position used for fit scoring;
 *  `label` is what we show on the pitch (e.g. an "RM" label backed by an RW pos). */
export type Slot = {
  id: string;     // e.g. "lcb", "st1" — unique within a formation
  pos: Position;  // canonical position for fit
  label: string;  // display label
  x: number;      // 0-100 pitch coord, 50 = centre
  y: number;      // 0-100, 5 = own goal (GK), 95 = opponent goal
};

/** A player placed into a specific slot. */
export type PlacedPlayer = {
  slot: string;          // Slot.id
  slotPos: Position;     // the slot's canonical position
  player_season_id: string;
  name: string;
  club: string;
  season: string;
  overall: number;
  position: Position;    // the player's own position
};

/** Projected 38-game season, derived from Strength Rating. */
export type Projected = {
  wins: number;
  draws: number;
  losses: number;
  points: number;
  position: number; // projected league finish 1-20
  tier: Tier;
};

export type Tier =
  | "INVINCIBLE"
  | "Centurions"
  | "Champions"
  | "Title Challengers"
  | "Europe"
  | "Mid-table"
  | "Relegation Battle"
  | "Relegated";

export type TeamStatus = "active" | "stale";

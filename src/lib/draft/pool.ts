/**
 * Draft XI — player pool access + spin logic.
 *
 * Wraps the shipped dataset (src/data/draft/player-seasons.json) with the runtime
 * indexes the game needs: spin a random (club, season) bucket, list the players in
 * it that can still fill an open slot, and look players up by id. Small enough
 * (~200 rows) to index in memory at import.
 */

import raw from "@/data/draft/player-seasons.json";
import type { League, NationEntry, PlayerSeason, Position } from "./types";
import { canPlay, playerIdentity } from "./score";
import { allWCNations, type WCNation } from "@/data/draft/wc2026";

/** Names of every nation at WC 2026 — the eligible set for the open "World Cup" draft. */
const WC_NATION_NAMES = new Set<string>(allWCNations().map((n) => n.nation));

type Bucket = { league: League; club: string; clubSlug: string; season: string; playerIds: string[] };

type Club = { name: string; clubSlug: string; season: string; league: League; strength: number };

const DATA = raw as unknown as {
  generatedAt: string;
  source: string;
  counts: { players: number; buckets: number; csvAdded: number };
  players: PlayerSeason[];
  buckets: Bucket[];
  clubs: Club[];
  nations?: NationEntry[]; // present after the WC-Run dataset rebuild
};

const byId = new Map<string, PlayerSeason>(DATA.players.map((p) => [p.id, p]));
const byNation = new Map<string, NationEntry>((DATA.nations ?? []).map((n) => [n.nation, n]));
/** Every player whose nationality is a WC 2026 nation — the open "World Cup" draft pool. */
const WC_PLAYERS: PlayerSeason[] = DATA.players.filter((p) => !!p.nationality && WC_NATION_NAMES.has(p.nationality));
/** Nation → crest, for labelling a World Cup spin. */
const WC_CREST = new Map<string, string>(allWCNations().map((n) => [n.nation, n.crest]));

export const POOL_META = DATA.counts;
/** Per-league counts (players + spinnable squads) for UI copy. */
export const LEAGUE_COUNTS = (DATA as { leagues?: Record<League, { players: number; buckets: number }> }).leagues ?? {
  PL: { players: DATA.counts.players, buckets: DATA.counts.buckets },
  LaLiga: { players: 0, buckets: 0 },
};

/** Buckets for one competition. */
function bucketsFor(league: League): Bucket[] {
  return DATA.buckets.filter((b) => b.league === league);
}

export function getPlayer(id: string): PlayerSeason | undefined {
  return byId.get(id);
}

export function getBucketPlayers(bucket: Bucket): PlayerSeason[] {
  return bucket.playerIds
    .map((id) => byId.get(id))
    .filter((p): p is PlayerSeason => !!p)
    .sort((a, b) => b.overall - a.overall);
}

/** A spin result: the dealt club-season plus its drafted-into-able players. */
export type Spin = {
  club: string;
  clubSlug: string;
  season: string;
  players: PlayerSeason[];
};

/**
 * Spin a random (club, season). If the dealt bucket has no player able to fill any
 * of `openSlotPositions` (or all its players are already drafted), re-spin — up to
 * a sane cap — so the user never dead-ends. Pass the positions of the slots still
 * open and the set of already-used player_season_ids.
 */
export function spin(
  openSlotPositions: Position[],
  usedPlayerIds: Set<string>,
  /** Canonical player identities already in the XI (see playerIdentity) — excludes
   *  the same player even under a different edition's name string. */
  usedIdentities: Set<string> = new Set(),
  rng: () => number = Math.random,
  /** Club-seasons already offered this draft, as "club|season". An already-offered
   *  squad is only re-dealt rarely (see REOFFER_SUPPRESS), so the same options don't
   *  keep coming up position after position — while the occasional same-squad double
   *  stays a fun surprise. Same club via a different season is unrestricted. */
  seen: Set<string> = new Set(),
  /** Which competition's squads to deal from. */
  league: League = "PL"
): Spin {
  const buckets = bucketsFor(league);
  const draftable = (b: Bucket) =>
    getBucketPlayers(b).filter(
      (p) =>
        !usedPlayerIds.has(p.id) &&
        !usedIdentities.has(playerIdentity(p.name)) && // no player twice, even across editions
        openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
    );

  // Already-offered squads slip through only ~15% of the time, so unseen squads are
  // strongly preferred but a repeat is still possible (a rare double), not banned.
  const REOFFER_SUPPRESS = 0.85;
  for (let attempt = 0; attempt < 80; attempt++) {
    const b = buckets[Math.floor(rng() * buckets.length)];
    if (seen.has(`${b.club}|${b.season}`) && rng() < REOFFER_SUPPRESS) continue;
    const players = draftable(b);
    if (players.length > 0) {
      return { club: b.club, clubSlug: b.clubSlug, season: b.season, players };
    }
  }

  // Extremely unlikely fallback: any bucket, still excluding already-used players.
  const b = buckets[Math.floor(rng() * buckets.length)];
  const players = getBucketPlayers(b).filter((p) => !usedPlayerIds.has(p.id) && !usedIdentities.has(playerIdentity(p.name)));
  return { club: b.club, clubSlug: b.clubSlug, season: b.season, players };
}

/** All spinnable buckets for a competition (for previews / the slot-machine reel). */
export function allBuckets(league: League = "PL"): Bucket[] {
  return bucketsFor(league);
}

// ── World Cup Run: nation-locked pool ───────────────────────────────────────

/** The nations that can field a full XI (+ upgrade headroom), most-stocked first. */
export function playableNations(): NationEntry[] {
  return (DATA.nations ?? []).filter((n) => n.playable);
}

export function getNation(nation: string): NationEntry | undefined {
  return byNation.get(nation);
}

export type PickableNation = WCNation & { count: number; lines: NationEntry["lines"] };

/** Nations a user can run a World Cup with = playable (enough PL depth) ∩ the real
 *  WC 2026 field, most-stocked first, with flag/abbr for the picker. */
export function pickableNations(): PickableNation[] {
  return allWCNations()
    .map((w) => ({ w, n: byNation.get(w.nation) }))
    .filter((x): x is { w: WCNation; n: NationEntry } => !!x.n && x.n.playable)
    .map(({ w, n }) => ({ ...w, count: n.count, lines: n.lines }))
    .sort((a, b) => b.count - a.count);
}

/** All players for a nation (sorted by overall desc), or [] if unknown. */
export function nationPlayers(nation: string): PlayerSeason[] {
  const n = byNation.get(nation);
  if (!n) return [];
  return n.playerIds
    .map((id) => byId.get(id))
    .filter((p): p is PlayerSeason => !!p)
    .sort((a, b) => b.overall - a.overall);
}

/**
 * Nation-locked spin: deal a candidate slate of `count` players FROM ONE NATION that
 * can fill an open slot, within an overall band [`minOverall`, `maxOverall`].
 *  - `minOverall` is the rising quality FLOOR for upgrade picks (better players each round).
 *  - `maxOverall` is the CEILING for the starting draft (lower-rated players to begin with).
 * If a nation lacks depth in the band, it's relaxed (cap raised first, then floor lowered)
 * so the player never dead-ends. Returns candidates sorted by overall desc.
 */
export function spinForNation(
  nation: string,
  openSlotPositions: Position[],
  usedPlayerIds: Set<string>,
  usedIdentities: Set<string> = new Set(),
  opts: { minOverall?: number; maxOverall?: number; count?: number } = {},
  rng: () => number = Math.random
): PlayerSeason[] {
  const count = opts.count ?? 5;
  const pool = nationPlayers(nation).filter(
    (p) =>
      !usedPlayerIds.has(p.id) &&
      !usedIdentities.has(playerIdentity(p.name)) &&
      openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
  );
  let floor = opts.minOverall ?? 0;
  let cap = opts.maxOverall ?? 99;
  const target = Math.min(count, pool.length);
  const within = () => pool.filter((p) => p.overall >= floor && p.overall <= cap);
  let eligible = within();
  // Relax to keep every nation fieldable: raise the ceiling first (so a thin nation can
  // still draft above the starting cap), then lower the floor.
  for (let guard = 0; eligible.length < target && guard < 40; guard++) {
    if (cap < 99) cap = Math.min(99, cap + 5);
    else if (floor > 0) floor = Math.max(0, floor - 5);
    else break;
    eligible = within();
  }
  const arr = eligible.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count).sort((a, b) => b.overall - a.overall);
}

/** Is this player eligible for the open World Cup draft (nationality at WC 2026)? */
export function isWCEligible(player: PlayerSeason): boolean {
  return !!player.nationality && WC_NATION_NAMES.has(player.nationality);
}

/** A World Cup spin: ONE nation, dealt by luck, plus its players for the open slot. */
export type WorldSpin = { nation: string; crest?: string; players: PlayerSeason[] };

/**
 * Open "World Cup" spin: land on ONE WC 2026 nation (luck of the spin) and offer THAT
 * nation's players for the open slot — like the base-game slot machine, but the bucket
 * is a country. Only nations that can actually fill the slot are in the draw. Selection
 * weight per nation is CAPPED, so the pool's English bias doesn't make England come up
 * every time — real footballing nations all appear, minnows occasionally. Pure luck on
 * rating — every overall is in play. Players sorted by overall desc.
 */
const SPIN_NATION_WEIGHT_CAP = 8;
export function spinWorld(
  openSlotPositions: Position[],
  usedPlayerIds: Set<string>,
  usedIdentities: Set<string> = new Set(),
  /** `minOverall`/`maxOverall` are the quiz-gated quality band (see draft-quiz.ts):
   *  a soft rating window. It's relaxed (ceiling up first, then floor down) when too
   *  few WC players fit, so a spin never comes up empty. */
  opts: { count?: number; minOverall?: number; maxOverall?: number } = {},
  rng: () => number = Math.random
): WorldSpin {
  const count = opts.count ?? 6;
  const fits = WC_PLAYERS.filter(
    (p) =>
      !usedPlayerIds.has(p.id) &&
      !usedIdentities.has(playerIdentity(p.name)) &&
      openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
  );
  if (fits.length === 0) return { nation: "", players: [] };
  // Narrow to the quality band, relaxing until at least a few players qualify.
  let floor = opts.minOverall ?? 0;
  let cap = opts.maxOverall ?? 99;
  const within = () => fits.filter((p) => p.overall >= floor && p.overall <= cap);
  let banded = within();
  for (let g = 0; banded.length < Math.min(count, 3) && g < 40; g++) {
    if (cap < 99) cap = Math.min(99, cap + 5);
    else if (floor > 0) floor = Math.max(0, floor - 5);
    else break;
    banded = within();
  }
  const eligible = banded.length ? banded : fits;
  // Group the fitting players by nation, then weighted-pick a nation (weight capped so a
  // deep nation like England doesn't crowd out the rest).
  const byNation = new Map<string, PlayerSeason[]>();
  for (const p of eligible) {
    const arr = byNation.get(p.nationality!) ?? [];
    arr.push(p);
    byNation.set(p.nationality!, arr);
  }
  const nations = Array.from(byNation.keys());
  const weights = nations.map((n) => Math.min(byNation.get(n)!.length, SPIN_NATION_WEIGHT_CAP));
  let r = rng() * weights.reduce((s, w) => s + w, 0);
  let nation = nations[0];
  for (let i = 0; i < nations.length; i++) { r -= weights[i]; if (r <= 0) { nation = nations[i]; break; } }
  const arr = byNation.get(nation)!.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { nation, crest: WC_CREST.get(nation), players: arr.slice(0, count).sort((a, b) => b.overall - a.overall) };
}

/** The 19 real clubs the season simulator plays against — the most recent FIFA
 *  season's clubs for that competition (a coherent modern league, whatever era you
 *  drafted from). Strengths are FIFA-derived. The player joins as the 20th team. */
export function leagueOpponents(league: League = "PL"): { name: string; strength: number }[] {
  const clubs = (DATA.clubs ?? []).filter((c) => c.league === league);
  const latest = clubs.reduce((m, c) => (c.season > m ? c.season : m), "");
  return clubs
    .filter((c) => c.season === latest)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 19)
    .map((c) => ({ name: c.name, strength: c.strength }));
}

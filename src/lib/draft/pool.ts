/**
 * Draft XI — player pool access + spin logic.
 *
 * Wraps the shipped dataset (src/data/draft/player-seasons.json) with the runtime
 * indexes the game needs: spin a random (club, season) bucket, list the players in
 * it that can still fill an open slot, and look players up by id. Small enough
 * (~200 rows) to index in memory at import.
 */

import raw from "@/data/draft/player-seasons.json";
import type { PlayerSeason, Position } from "./types";
import { canPlay, playerIdentity } from "./score";

type Bucket = { club: string; clubSlug: string; season: string; playerIds: string[] };

type Club = { name: string; clubSlug: string; season: string; strength: number };

const DATA = raw as unknown as {
  generatedAt: string;
  source: string;
  counts: { players: number; buckets: number; csvAdded: number };
  players: PlayerSeason[];
  buckets: Bucket[];
  clubs: Club[];
};

const byId = new Map<string, PlayerSeason>(DATA.players.map((p) => [p.id, p]));

export const POOL_META = DATA.counts;

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
  rng: () => number = Math.random
): Spin {
  const buckets = DATA.buckets;
  const draftable = (b: Bucket) =>
    getBucketPlayers(b).filter(
      (p) =>
        !usedPlayerIds.has(p.id) &&
        !usedIdentities.has(playerIdentity(p.name)) && // no player twice, even across editions
        openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
    );
  for (let attempt = 0; attempt < 60; attempt++) {
    const b = buckets[Math.floor(rng() * buckets.length)];
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

/** All spinnable buckets (for previews / the slot-machine reel). */
export function allBuckets(): Bucket[] {
  return DATA.buckets;
}

/** The 19 real clubs the season simulator plays against — the most recent FIFA
 *  season's Premier League (a coherent modern league, whatever era you drafted
 *  from). Strengths are FIFA-derived. The player joins as the 20th team. */
export function leagueOpponents(): { name: string; strength: number }[] {
  const clubs = DATA.clubs ?? [];
  const latest = clubs.reduce((m, c) => (c.season > m ? c.season : m), "");
  return clubs
    .filter((c) => c.season === latest)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 19)
    .map((c) => ({ name: c.name, strength: c.strength }));
}

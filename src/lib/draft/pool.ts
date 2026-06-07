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
import { canPlay } from "./score";

type Bucket = { club: string; clubSlug: string; season: string; playerIds: string[] };

const DATA = raw as unknown as {
  generatedAt: string;
  source: string;
  counts: { players: number; buckets: number; csvAdded: number };
  players: PlayerSeason[];
  buckets: Bucket[];
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
  rng: () => number = Math.random
): Spin {
  const buckets = DATA.buckets;
  for (let attempt = 0; attempt < 40; attempt++) {
    const b = buckets[Math.floor(rng() * buckets.length)];
    const players = getBucketPlayers(b).filter(
      (p) => !usedPlayerIds.has(p.id) && openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
    );
    if (players.length > 0) {
      return { club: b.club, clubSlug: b.clubSlug, season: b.season, players };
    }
  }
  // Extremely unlikely fallback: return any bucket's full list.
  const b = buckets[Math.floor(rng() * buckets.length)];
  return { club: b.club, clubSlug: b.clubSlug, season: b.season, players: getBucketPlayers(b) };
}

/** All spinnable buckets (for previews / the slot-machine reel). */
export function allBuckets(): Bucket[] {
  return DATA.buckets;
}

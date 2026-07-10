/** Fantasy player pool — server-only loader for src/data/fantasy/pool.json. */
import "server-only";
import poolJson from "@/data/fantasy/pool.json";
import type { FantasyPos, PoolPlayer } from "./engine";

export interface FantasyPoolFile {
  version: string;
  mode: "replay" | "live";
  smSeasonId: number;
  players: {
    id: number; smId: number; name: string; club: string;
    clubId: number; pos: FantasyPos; price: number;
  }[];
}

const POOL = poolJson as unknown as FantasyPoolFile;

export function fantasyPool(): FantasyPoolFile {
  return POOL;
}

/** The pool in engine shape (integer-tenths prices). */
let engineCache: PoolPlayer[] | null = null;
export function enginePool(): PoolPlayer[] {
  if (!engineCache)
    engineCache = POOL.players.map((p) => ({
      id: p.id, smId: p.smId, name: p.name, club: p.club, clubId: p.clubId,
      pos: p.pos, priceTenths: Math.round(p.price * 10),
    }));
  return engineCache;
}

/** Client-safe pool (identical minus smId — nothing secret, just irrelevant). */
export function clientPool() {
  return {
    version: POOL.version,
    players: POOL.players.map((p) => ({
      id: p.id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos, price: p.price,
    })),
  };
}

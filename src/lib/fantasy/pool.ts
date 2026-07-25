/** Fantasy player pool — server-only loader for src/data/fantasy/pool.json.
 *
 *  pool.json owns player IDENTITY (id, smId, name, club, position) and a seed
 *  price. It does NOT own the live price: prices track FPL weekly, and this file
 *  is a static import frozen into the build — a price change here would need a
 *  redeploy. The live price for a gameweek lives in `fantasy_player_prices`,
 *  snapshotted at gameweek open. Use `pricedPool(db, gw)` for anything that
 *  touches the bank; `enginePool()` is identity + seed only. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import poolJson from "@/data/fantasy/pool.json";
import type { FantasyPos, PoolPlayer } from "./engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

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

/** The pool in engine shape, at SEED prices. Identity is always right here; the
 *  price is only right before the season's first snapshot. Fine for identity
 *  (ingest) and for the form proxy; use pricedPool() for money. */
let engineCache: PoolPlayer[] | null = null;
export function enginePool(): PoolPlayer[] {
  if (!engineCache)
    engineCache = POOL.players.map((p) => ({
      id: p.id, smId: p.smId, name: p.name, club: p.club, clubId: p.clubId,
      pos: p.pos, priceTenths: Math.round(p.price * 10),
    }));
  return engineCache;
}

/** Read a gameweek's price snapshot. */
export async function gwPrices(db: Db, gw: number): Promise<Map<number, number>> {
  const { data, error } = await db.from("fantasy_player_prices")
    .select("player_id, price_tenths").eq("gw", gw).range(0, 9999);
  if (error) throw new Error(`prices for gw ${gw}: ${error.message}`);
  return new Map(((data ?? []) as { player_id: number; price_tenths: number }[])
    .map((r) => [r.player_id, r.price_tenths]));
}

/** THE pool for anything that touches the bank — identity from pool.json, price
 *  from this gameweek's snapshot.
 *
 *  A player with no snapshot row keeps his seed price rather than becoming free:
 *  a missing snapshot must degrade to "prices haven't moved", never to "everything
 *  costs nothing", which would let one bad fetch hand out a squad of superstars. */
export async function pricedPool(db: Db, gw: number): Promise<PoolPlayer[]> {
  const priceOf = await gwPrices(db, gw);
  return enginePool().map((p) =>
    priceOf.has(p.id) ? { ...p, priceTenths: priceOf.get(p.id)! } : p);
}

/** Client-safe pool at THIS gameweek's prices (minus smId — nothing secret, just
 *  irrelevant). The builder and the transfer screen quote money off this, so it
 *  has to agree with what the server will charge, or a user picks a squad at one
 *  price and gets rejected at another. */
export async function clientPricedPool(db: Db, gw: number) {
  const priceOf = await gwPrices(db, gw);
  return {
    version: POOL.version,
    gw,
    players: POOL.players.map((p) => ({
      id: p.id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos,
      price: priceOf.has(p.id) ? priceOf.get(p.id)! / 10 : p.price,
    })),
  };
}

/** Client-safe pool at SEED prices (identical minus smId). */
export function clientPool() {
  return {
    version: POOL.version,
    players: POOL.players.map((p) => ({
      id: p.id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos, price: p.price,
    })),
  };
}

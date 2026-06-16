import "server-only";
import { createHmac } from "crypto";

/**
 * Peppered shootout seed: deterministic server-side, unpredictable client-side.
 * Without this, a client could derive the AI keeper / CPU shooter from the public
 * match id, simulate all six zones, and submit only the kick that scores. Keys are
 * stable per shootout (e.g. `${matchId}:pens`, `${runSeed}:pens:${stage}:${idx}`)
 * so per-kick resolution and any later recompute agree.
 */
export function pensSeed(key: string): string {
  const secret = process.env.PENS_SEED_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("pensSeed: no PENS_SEED_SECRET or SUPABASE_SERVICE_ROLE_KEY set");
  return createHmac("sha256", secret).update(key).digest("hex").slice(0, 32);
}

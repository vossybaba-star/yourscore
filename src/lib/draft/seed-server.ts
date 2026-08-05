import "server-only";
import { createHmac } from "crypto";

/**
 * Peppered seed: deterministic server-side, unpredictable client-side. Without
 * this, a client could derive a seeded outcome (e.g. a gated-draft quiz slate)
 * from public inputs and precompute the answer. Keys are stable per use
 * (e.g. `wc-draft:${date}:${salt}:step:${k}`) so per-step resolution and any
 * later recompute agree. Env var keeps its historical name so existing prod
 * secrets — and every already-dealt deterministic slate — stay valid.
 */
export function serverSeed(key: string): string {
  const secret = process.env.PENS_SEED_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("serverSeed: no PENS_SEED_SECRET or SUPABASE_SERVICE_ROLE_KEY set");
  return createHmac("sha256", secret).update(key).digest("hex").slice(0, 32);
}

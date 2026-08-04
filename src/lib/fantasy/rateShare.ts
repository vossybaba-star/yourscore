/**
 * Shared Scout rating store (/r/[id]) — read + create.
 *
 * A rated team is written once (immutable) and read back by the public share
 * page and its unfurl card. Raw PostgREST over global fetch so the SAME code
 * runs in both the node page and the edge opengraph-image — supabase-js and
 * `@/lib/supabase/*` server helpers are not both-runtime safe, this is.
 *
 * The table has no anon/authenticated RLS policy, so only the service role can
 * read or write it; the key is a server env var, never NEXT_PUBLIC.
 */
import "server-only";
import type { RateShareRow, RateSharePlayer, RatingView } from "./rateShareTypes";

// Project-ref REST base, not the NEXT_PUBLIC custom auth domain — this always
// resolves the data API regardless of custom-domain routing.
const REST = "https://mznvuswzgkaupvaqznkm.supabase.co/rest/v1/fantasy_rate_share";

function serviceKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  return k;
}

function authHeaders(): Record<string, string> {
  const k = serviceKey();
  return { apikey: k, authorization: `Bearer ${k}` };
}

/** Read one snapshot. Returns null on miss or any transport error — the page
 *  and card both render a graceful fallback rather than throwing. */
export async function fetchRateShare(id: string): Promise<RateShareRow | null> {
  try {
    const res = await fetch(
      `${REST}?id=eq.${encodeURIComponent(id)}&select=id,rating,players,source,created_at&limit=1`,
      { headers: authHeaders(), cache: "no-store" },
    );
    if (!res.ok) return null;
    const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      rating: r.rating as RatingView,
      players: (r.players as RateSharePlayer[]) ?? [],
      source: (r.source as string | null) ?? null,
      createdAt: String(r.created_at),
    };
  } catch {
    return null;
  }
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (0/o/1/l)

/** 10-char url-safe id from the platform CSPRNG (works in node + edge). */
function shortId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Persist a rated team and return its share id. `rating` is passed straight
 *  through as jsonb (a RatingResponse); `players` is the 15 the pitch draws. */
export async function createRateShare(input: {
  rating: unknown;
  players: RateSharePlayer[];
  source?: string;
}): Promise<string> {
  const id = shortId();
  const res = await fetch(REST, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ id, rating: input.rating, players: input.players, source: input.source ?? null }),
  });
  if (!res.ok) throw new Error(`rate-share insert failed: ${res.status}`);
  return id;
}

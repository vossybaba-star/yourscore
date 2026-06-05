// In-memory rate limiter — per-instance only (bypassable across serverless
// instances). Kept for non-critical/local use. For real protection use
// rateLimitDistributed() below, which shares a counter across all instances.

import { createServiceClient } from "@/lib/supabase/service";

interface Entry { count: number; resetAt: number; }
const store = new Map<string, Entry>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }

  if (entry.count >= max) {
    return { ok: false, remaining: 0 };
  }

  entry.count++;
  return { ok: true, remaining: max - entry.count };
}

// Clean up expired entries every 5 minutes to avoid memory leak
setInterval(() => {
  const now = Date.now();
  store.forEach((v, k) => {
    if (now > v.resetAt) store.delete(k);
  });
}, 5 * 60 * 1000);

// Distributed rate limiter backed by Postgres (shared across all serverless
// instances). Returns { ok }. Fails OPEN on infrastructure error so a limiter
// outage never blocks legitimate users.
export async function rateLimitDistributed(
  key: string,
  max: number,
  windowMs: number
): Promise<{ ok: boolean }> {
  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc("check_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error) return { ok: true };
    return { ok: data === true };
  } catch {
    return { ok: true };
  }
}

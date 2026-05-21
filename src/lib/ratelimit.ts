// In-memory rate limiter. Resets on server restart (fine for Edge/serverless per-instance).
// Replace with Redis (Upstash) for distributed rate limiting in production.

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

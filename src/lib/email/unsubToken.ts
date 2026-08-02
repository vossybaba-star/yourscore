import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe tokens.
 *
 * The unsubscribe link used to carry the raw `u=<userId>`, described in the route
 * as "a random UUIDv4 — an unguessable bearer token". That premise was false: user
 * ids are published by ungated public endpoints (/api/leaderboard/wc2026,
 * /api/comments, /api/draft/wc/leaderboard all return user_id per row), so anyone
 * could scrape them and permanently suppress every user's email — email_suppressions
 * is the table every send path filters against.
 *
 * A token now proves the link came from an email WE sent: userId + expiry, signed
 * with a server-only key. Nothing user-supplied is trusted except the signature.
 *
 * KEY: derived from SUPABASE_SERVICE_ROLE_KEY rather than a new env var, on purpose.
 * A dedicated secret that is merely *forgotten* in one environment would make every
 * unsubscribe link in that environment fail to verify — and a broken unsubscribe is a
 * compliance problem, not just a bug. The service-role key is guaranteed present
 * anywhere this route can run (the route already needs it). It is never exposed; only
 * an HMAC of it leaves the server, and the label gives domain separation so these
 * tokens can't be replayed against anything else that uses the same key.
 */

const LABEL = "yourscore:email-unsub:v1";
/** 180 days. Long, deliberately: people unsubscribe from old mail, and an expired
 *  link that silently fails is worse than a slightly long-lived one. */
const TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Keys this deployment will ACCEPT, best first. Signing always uses the first.
 *
 * Two sources, because a single one has a failure mode either way:
 *   - EMAIL_UNSUB_SECRET (preferred): a shared secret, so a link minted by the VPS
 *     send scripts verifies on Vercel. Deriving from the service-role key alone does
 *     NOT survive that hop — the keys drift between environments, and a link that
 *     can't be verified is an unsubscribe that doesn't work.
 *   - the service-role key (fallback): guaranteed present wherever this route runs,
 *     so nothing breaks before the shared secret is set anywhere.
 *
 * Verification tries every candidate, which is also what makes rotation safe: set
 * the new secret, and links already in inboxes keep verifying under the old one.
 */
function candidateKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const dedicated = process.env.EMAIL_UNSUB_SECRET;
  if (dedicated) keys.push(createHash("sha256").update(`${LABEL}:${dedicated}`).digest());
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (service) keys.push(createHash("sha256").update(`${LABEL}:${service}`).digest());
  if (keys.length === 0) throw new Error("unsubToken: no EMAIL_UNSUB_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  return keys;
}

function signWith(k: Buffer, payload: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 24);
}

function sign(payload: string): string {
  return signWith(candidateKeys()[0], payload);
}

/** `<userId>.<expiryUnixSeconds>.<sig>` — URL-safe, ~70 chars. */
export function signUnsubToken(userId: string, ttlSeconds: number = TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the userId if the token is authentic and unexpired, else null. */
export function verifyUnsubToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expRaw, sig] = parts;
  if (!userId || !expRaw || !sig) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

  // Accept a signature from ANY candidate key (see candidateKeys) so a link minted
  // by another environment, or under a pre-rotation secret, still verifies.
  const a = createHash("sha256").update(sig).digest();
  for (const k of candidateKeys()) {
    const b = createHash("sha256").update(signWith(k, `${userId}.${expRaw}`)).digest();
    // Fixed-length digests: a length mismatch can't throw, and the compare is
    // constant-time.
    if (timingSafeEqual(a, b)) return userId;
  }
  return null;
}

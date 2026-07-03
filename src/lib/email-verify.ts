/**
 * Server-side email DELIVERABILITY verification (MX / A-record lookup).
 *
 * Why: src/lib/email.ts only checks *shape* (regex) + a 3-domain blocklist. That
 * lets typo'd-but-valid addresses (jsmith@gmailx.com, user@nodomainhere.zzz) through,
 * they get a magic-link / confirmation email, it bounces, and the bounces cost us our
 * Resend sending reputation (account suspended Jun/Jul 2026 for high bounce rate).
 *
 * This adds the missing check: does the domain actually run a mail server? We resolve
 * MX (falling back to A/AAAA per RFC 5321 §5) and reject domains that resolve to
 * "no mail here" or don't exist at all. Transient DNS failures FAIL OPEN — we never
 * block a real user because a resolver hiccupped.
 *
 * Node runtime only (uses node:dns). Reused by scripts/verify-audience.mjs (mirrored,
 * since that's plain .mjs and can't import this TS module).
 */
import { promises as dns } from "node:dns";
import {
  normalizeEmail,
  isValidEmailFormat,
  isBlockedEmailDomain,
  suggestEmailCorrection,
} from "./email";

export type DeliverabilityStatus =
  | "ok"
  | "bad_format"
  | "blocked_domain"
  | "likely_typo"
  | "no_mail_server"
  | "unknown";

export interface DeliverabilityResult {
  ok: boolean;
  status: DeliverabilityStatus;
  reason?: string;
  suggestion?: string | null;
}

// Per-domain cache so a burst of gmail signups does one lookup, not thousands.
// null = we couldn't tell (transient) and shouldn't cache-poison for long.
const domainCache = new Map<string, { at: number; acceptsMail: boolean | null }>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h for a definite yes/no
const TTL_UNKNOWN_MS = 5 * 60 * 1000; // 5m for "unknown" — retry sooner

/**
 * true  → domain runs a mail server (has MX, or A/AAAA fallback)
 * false → domain exists-check says it cannot receive mail (NXDOMAIN or no MX + no A)
 * null  → couldn't determine (SERVFAIL / timeout / network) → caller should fail open
 */
export async function domainAcceptsMail(domain: string): Promise<boolean | null> {
  const hit = domainCache.get(domain);
  if (hit) {
    const ttl = hit.acceptsMail === null ? TTL_UNKNOWN_MS : TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.acceptsMail;
  }

  let acceptsMail: boolean | null;
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.some((r) => r.exchange)) {
      acceptsMail = true;
    } else {
      // No usable MX — RFC 5321 permits delivery to the A/AAAA host.
      acceptsMail = await hasAddressRecord(domain);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "NXDOMAIN" || code === "ENODATA") {
      // Domain doesn't exist, or has no MX records at all — check A as last resort.
      acceptsMail = await hasAddressRecord(domain);
    } else {
      acceptsMail = null; // SERVFAIL / ETIMEOUT / etc. — unknown
    }
  }

  domainCache.set(domain, { at: Date.now(), acceptsMail });
  return acceptsMail;
}

async function hasAddressRecord(domain: string): Promise<boolean> {
  try {
    const a = await dns.resolve(domain);
    return a.length > 0;
  } catch {
    try {
      const aaaa = await dns.resolve6(domain);
      return aaaa.length > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Full gate: shape → blocklist → known-typo → live mail server.
 * Typos are now a HARD block (with the correction surfaced) rather than a soft nudge,
 * because those domains are a leading bounce source.
 */
export async function verifyEmailDeliverable(email: string): Promise<DeliverabilityResult> {
  const e = normalizeEmail(email);

  if (!isValidEmailFormat(e)) {
    return { ok: false, status: "bad_format", reason: "Enter a valid email address.", suggestion: suggestEmailCorrection(e) };
  }
  if (isBlockedEmailDomain(e)) {
    return { ok: false, status: "blocked_domain", reason: "Please enter a real email address." };
  }
  const suggestion = suggestEmailCorrection(e);
  if (suggestion) {
    return { ok: false, status: "likely_typo", reason: `Did you mean ${suggestion}?`, suggestion };
  }

  const domain = e.split("@")[1] ?? "";
  const accepts = await domainAcceptsMail(domain);
  if (accepts === false) {
    return { ok: false, status: "no_mail_server", reason: "That email domain can't receive mail — check the spelling." };
  }

  // true (confirmed) or null (transient/unknown) → allow. Never block on a DNS hiccup.
  return { ok: true, status: accepts === null ? "unknown" : "ok", suggestion: null };
}

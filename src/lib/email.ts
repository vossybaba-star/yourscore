/**
 * Email validation + common-typo correction.
 *
 * Purpose: cut the transactional-email bounce rate (Supabase flagged it, Jun 2026).
 * Magic-link and password-reset emails were being sent to malformed / fake / typo'd
 * addresses entered by signups (esp. paid-ad traffic). We block the clearly-invalid
 * ones and nudge likely typos before any email is sent.
 *
 * Mirrors the guard in scripts/send-reengagement.mjs and scripts/delete-fake-profiles.mjs.
 */

// Conservative RFC-ish shape check: one @, a dot in the domain, no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Domains that are never real inboxes — reject outright.
const BLOCKED_DOMAINS = new Set(["yourscore.fake", "example.com", "test.com"]);

// Common misspellings of popular providers → the correct domain. Used for a
// non-blocking "did you mean…?" nudge, not a hard block.
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com", "gmail.comm": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotnail.com": "hotmail.com",
  "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com",
  "outlool.com": "outlook.com", "outlok.com": "outlook.com", "outloo.com": "outlook.com",
  "outlook.con": "outlook.com", "outlook.co": "outlook.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com",
  "yahoo.co": "yahoo.com", "yhaoo.com": "yahoo.com",
  "icloud.con": "icloud.com", "iclod.com": "icloud.com", "icloud.co": "icloud.com",
  "live.con": "live.com", "live.co": "live.com",
};

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  const e = normalizeEmail(email);
  return EMAIL_RE.test(e) && e.length <= 254;
}

export function isBlockedEmailDomain(email: string): boolean {
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  return BLOCKED_DOMAINS.has(domain);
}

/** Suggested correction if the domain is a known typo, else null. */
export function suggestEmailCorrection(email: string): string | null {
  const e = normalizeEmail(email);
  const at = e.indexOf("@");
  if (at < 1) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const fixed = DOMAIN_TYPOS[domain];
  return fixed ? `${local}@${fixed}` : null;
}

export interface EmailCheck {
  ok: boolean;
  /** Why the email was rejected (only set when ok === false). */
  reason?: string;
  /** Non-blocking typo suggestion (may be set whether ok is true or false). */
  suggestion?: string | null;
}

/**
 * One-call gate for the auth UI. Blocks malformed and known-fake addresses;
 * returns a typo suggestion for the caller to surface non-blockingly.
 */
export function checkEmail(email: string): EmailCheck {
  if (!isValidEmailFormat(email)) {
    return { ok: false, reason: "Enter a valid email address.", suggestion: suggestEmailCorrection(email) };
  }
  if (isBlockedEmailDomain(email)) {
    return { ok: false, reason: "Please enter a real email address." };
  }
  return { ok: true, suggestion: suggestEmailCorrection(email) };
}

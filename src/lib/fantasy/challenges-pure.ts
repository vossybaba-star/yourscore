/**
 * challenges.ts — pure input normalizers (Phase 3A).
 *
 * Deliberately split out of challenges.ts: challenges.ts carries
 * `import "server-only"`, which THROWS the moment the module is `require()`d
 * outside a React Server Component context (see node_modules/server-only/
 * index.js) — so it cannot be loaded by a plain `node --test` run. ops.ts and
 * context.ts hit the same wall; the fix already in this codebase (ops-diff.ts,
 * clubKey.ts) is the same one applied here: keep the pure, testable logic in
 * a plain module and let the server-only file import it, not the other way
 * round. No throwing HttpError here either, for the same reason (HttpError
 * lives in server.ts, itself `server-only`) — a result object instead, so
 * createChallenge in challenges.ts decides how to turn a rejection into the
 * 400 the API route returns.
 */

export const MESSAGE_MAX_LEN = 140;

export type MessageValidation =
  | { ok: true; message: string | null }
  | { ok: false; error: string };

/** A createChallenge message: strip newlines (a chat card renders this on a
 *  single quoted line, never a block), trim, then cap at 140 characters —
 *  over the cap rejects rather than silently truncating, so the sender knows
 *  to shorten it instead of finding it clipped after the fact. No message at
 *  all (undefined/blank) is fine — a challenge doesn't require one. */
export function normalizeChallengeMessage(value: unknown): MessageValidation {
  if (typeof value !== "string") return { ok: true, message: null };
  const stripped = value.replace(/[\r\n]+/g, " ").trim();
  if (!stripped) return { ok: true, message: null };
  if (stripped.length > MESSAGE_MAX_LEN) return { ok: false, error: "Keep the message under 140 characters." };
  return { ok: true, message: stripped };
}

/** Every surface a challenge can be started from, for attribution — see
 *  migration 258's created_from doc. Whitelisted rather than free text: an
 *  unrecognised value (stale client build, hand-crafted request) falls back
 *  to the default surface silently instead of either rejecting the challenge
 *  or storing junk that breaks a future "challenges by surface" report. */
const CREATED_FROM_VALUES = new Set([
  "member_action", "league_table", "league_chat", "profile", "compare_squads", "social_post",
]);
export const DEFAULT_CREATED_FROM = "member_action";

export function normalizeCreatedFrom(value: unknown): string {
  return typeof value === "string" && CREATED_FROM_VALUES.has(value) ? value : DEFAULT_CREATED_FROM;
}

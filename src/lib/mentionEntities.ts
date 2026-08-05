/**
 * Pure @mention text parsing + structured-entity validation — deliberately NO
 * `server-only` import, so this is unit-testable through plain `tsx --test`
 * with no DB/Next.js runtime involved (same convention lib/fantasy/months.ts
 * documents for exactly this reason). The DB-touching half (resolveUsernames,
 * resolveMentionEntities) lives in lib/mentions.ts, which re-exports
 * everything here so existing callers see one module.
 */

/**
 * @username parsing — shared by the Social feed (posts) and the comment
 * thread (fantasy_feed comments), Phase 3b. A real, resolvable handle is
 * lowercase letters/digits/underscore, 3-24 chars — the same shape
 * lib/fantasy/chat.ts's league-chat mentions already assume at lookup time,
 * just made explicit here as one pattern both callers share.
 */
export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Every @handle in a body of text, deduped, lowercased, first-appearance
 *  order. This does NOT check they're real usernames — a typo'd or made-up
 *  handle simply never appears in resolveUsernames' returned map, and the
 *  caller (render or notify) treats it as plain text. The capture group is
 *  looser than USERNAME_RE (2-30, any case) so "@Bob" or a 2-char handle
 *  still gets a lookup attempt; USERNAME_RE narrows it before it's kept. */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of Array.from(text.matchAll(/@([a-zA-Z0-9_]{2,30})/g))) {
    const handle = m[1].toLowerCase();
    if (!USERNAME_RE.test(handle) || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

// ── Structured mentions (Phase 1A) ───────────────────────────────────────────

/**
 * A mention as PICKED from the autocomplete dropdown — token-based, not
 * offset-based. An offset pair (start/end index into the text) breaks the
 * moment the surrounding text is edited (a character typed before the
 * mention shifts every offset after it); the @handle TOKEN itself is the
 * anchor instead, so an edit anywhere else in the body leaves every mention
 * still resolvable. `usernameSnapshot` is the username AT PICK TIME — never
 * re-resolved on render, so a renamed account's old posts still link the
 * handle the author actually typed (same "frozen at write time" contract the
 * regex+resolve path has always had, just now explicit).
 */
export interface MentionEntity { userId: string; usernameSnapshot: string }

/** Hard ceiling on how many structured entities one post/reply/message can
 *  carry — a mass-mention shouldn't bloat the payload (or the notify fan-out,
 *  see MAX_MENTION_NOTIFY in lib/fantasy/mentions.ts, a separate, smaller cap
 *  on how many of these actually get a push). */
export const MAX_MENTION_ENTITIES = 10;

/**
 * The trust boundary for client-submitted mention entities (AC1). `submitted`
 * is whatever the composer sent — untrusted shape, possibly stale, possibly
 * hand-crafted. An entity survives ONLY if:
 *
 *   1. its `usernameSnapshot` (case-insensitively) is an @handle TOKEN that
 *      actually appears in `text` right now — an entity for a handle the
 *      user deleted before submitting, or that was never really there, is
 *      dropped;
 *   2. `ownerOf` (a batch profiles lookup reflecting CURRENT database state)
 *      says that username is STILL owned by that same userId — if the
 *      handle got reassigned to someone else since the client tagged it
 *      (a rename), the stale tag is dropped, never silently re-attributed.
 *
 * A text handle the client never tagged (hand-typed, no autocomplete pick —
 * or a tag that got dropped by rule 2 above) still resolves via `ownerOf`,
 * exactly like the legacy regex+resolve path — so a plain @mention keeps
 * working exactly as it always has, and a stale tag degrades to "resolve the
 * handle fresh" rather than "no mention at all".
 *
 * Pure and DB-free (unit-testable on its own) — `ownerOf` is the caller's one
 * batch query, done once by `resolveMentionEntities` in lib/mentions.ts.
 * Order follows first-appearance order in `text` (same order extractMentions
 * returns), capped at MAX_MENTION_ENTITIES.
 */
export function buildMentionEntities(
  text: string,
  submitted: unknown,
  ownerOf: Map<string, { id: string; username: string }>,
): MentionEntity[] {
  const handles = extractMentions(text);
  if (!handles.length) return [];

  // A validated submitted entity per handle — first one wins if the client
  // somehow sent two for the same handle.
  const submittedByHandle = new Map<string, MentionEntity>();
  if (Array.isArray(submitted)) {
    for (const raw of submitted as unknown[]) {
      const e = raw as { userId?: unknown; usernameSnapshot?: unknown };
      const userId = typeof e?.userId === "string" ? e.userId : "";
      const usernameSnapshot = typeof e?.usernameSnapshot === "string" ? e.usernameSnapshot : "";
      if (!userId || !usernameSnapshot) continue;
      const handle = usernameSnapshot.toLowerCase();
      if (!USERNAME_RE.test(handle) || submittedByHandle.has(handle)) continue;
      const owner = ownerOf.get(handle);
      if (!owner || owner.id !== userId) continue; // not in text, or a stale/wrong tag — dropped
      submittedByHandle.set(handle, { userId, usernameSnapshot });
    }
  }

  const out: MentionEntity[] = [];
  for (const handle of handles) {
    const tagged = submittedByHandle.get(handle);
    if (tagged) { out.push(tagged); continue; }
    const owner = ownerOf.get(handle); // untagged (or dropped) — resolve fresh, today's behaviour
    if (owner) out.push({ userId: owner.id, usernameSnapshot: owner.username });
  }
  return out.slice(0, MAX_MENTION_ENTITIES);
}

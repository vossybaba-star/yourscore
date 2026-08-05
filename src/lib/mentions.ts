import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/**
 * @username parsing + resolution — shared by the Social feed (posts) and the
 * comment thread (fantasy_feed comments), Phase 3b. A real, resolvable
 * handle is lowercase letters/digits/underscore, 3-24 chars — the same shape
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

/** Resolve a batch of lowercased handles to real profiles in ONE query — an
 *  exact case-insensitive match per handle (usernames are unique only
 *  case-insensitively, migration 47), never a wildcard/substring match, so a
 *  mention can't accidentally resolve to the wrong account. Handles with no
 *  matching profile are simply absent from the returned map. */
export async function resolveUsernames(
  db: Db, handles: string[],
): Promise<Map<string, { id: string; username: string }>> {
  const map = new Map<string, { id: string; username: string }>();
  if (!handles.length) return map;
  const { data } = await db
    .from("profiles")
    .select("id, username")
    .not("username", "is", null)
    .or(handles.map((h) => `username.ilike.${h}`).join(","));
  for (const p of (data ?? []) as { id: string; username: string | null }[]) {
    if (p.username && handles.includes(p.username.toLowerCase())) {
      map.set(p.username.toLowerCase(), { id: p.id, username: p.username });
    }
  }
  return map;
}

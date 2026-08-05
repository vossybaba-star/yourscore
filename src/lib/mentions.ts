import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractMentions, buildMentionEntities, type MentionEntity } from "./mentionEntities";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

// Pure text parsing + structured-entity validation lives in mentionEntities.ts
// (no `server-only`, so it's unit-testable standalone) — re-exported here so
// every existing caller of "@/lib/mentions" keeps working unchanged.
export { USERNAME_RE, extractMentions, MAX_MENTION_ENTITIES, buildMentionEntities, type MentionEntity } from "./mentionEntities";

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

/** Server-side wrapper around buildMentionEntities (Phase 1A) — the one batch
 *  profiles query (every @handle actually in `text`, submitted-tagged or
 *  not) plus the pure validate+merge. This is what postToFeed, the comments
 *  POST route, and postChat actually call. */
export async function resolveMentionEntities(
  db: Db, text: string, submitted: unknown,
): Promise<MentionEntity[]> {
  const handles = extractMentions(text);
  if (!handles.length) return [];
  const ownerOf = await resolveUsernames(db, handles);
  return buildMentionEntities(text, submitted, ownerOf);
}

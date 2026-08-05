import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractMentions, resolveUsernames, type MentionEntity } from "@/lib/mentions";
import { notifyFantasy } from "./notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

// The health-check QA accounts — same two ids feed.ts's syntheticActors()
// hardcodes, for the same reason (HEALTH_BOT_USER_ID isn't guaranteed to be
// set everywhere, and a missing env var must never let a bot get "mentioned"
// notifications or, worse, notify real users on the bot's behalf). Kept as a
// tiny local copy rather than importing feed.ts's private set, to avoid a
// feed.ts <-> mentions.ts import cycle (feed.ts calls into this module too).
const QA_ACCOUNT_IDS = [
  "cf78de0e-da93-4fb8-b3cd-8865ae0a0814", // hc
  "aa6542bc-ea1d-480c-9070-4a6b79c87381", // hc2
];
const syntheticIds = () => new Set([...QA_ACCOUNT_IDS, process.env.HEALTH_BOT_USER_ID ?? ""].filter(Boolean));

/** Cap on how many mentioned users get notified from one post/comment (AC4) —
 *  a mass-mention isn't a spam vector for the mention itself (still linkifies
 *  for everyone), just for how many pushes it fires. */
export const MAX_MENTION_NOTIFY = 5;

/**
 * Notify every REAL, resolvable @username mentioned in a post or comment body
 * — the ONE seam both postToFeed (lib/fantasy/feed.ts) and the fantasy_feed
 * branch of the comments API (app/api/comments/route.ts) call. Reuses
 * notifyFantasy, so it's dark until FANTASY_NOTIFY_ENABLED flips, same as
 * every other fantasy notification. Best-effort — never throws, so a mention
 * notify can never fail the post/comment it rides on.
 *
 * `dedupeSubjectId` is the thing whose FIRST mention of a given person should
 * notify once — the POST's id for a post mention, the COMMENT's id for a
 * reply mention (never the post id for a comment: two different comments on
 * the same post mentioning the same person are two separate notifications).
 */
export async function notifyMentions(opts: {
  db: Db;
  text: string;
  actorId: string;
  dedupeSubjectId: string;
  /** Where the notification's tap lands — the post's detail page. */
  url: string;
  /** Validated structured entities (Phase 1A) — when the caller already has
   *  these (postToFeed, the comments POST route), pass them through so this
   *  function drives off them directly instead of re-running its own
   *  regex+resolve. Absent/empty falls back to the legacy path unchanged —
   *  a caller that hasn't been touched still works exactly as before. */
  entities?: MentionEntity[];
}): Promise<void> {
  try {
    let resolvedUsers: { id: string; username: string }[];
    if (opts.entities && opts.entities.length) {
      resolvedUsers = opts.entities.map((e) => ({ id: e.userId, username: e.usernameSnapshot }));
    } else {
      const handles = extractMentions(opts.text);
      if (!handles.length) return;
      const resolved = await resolveUsernames(opts.db, handles);
      resolvedUsers = Array.from(resolved.values());
    }
    const bots = syntheticIds();
    const mentioned = resolvedUsers
      .filter((u) => u.id !== opts.actorId && !bots.has(u.id))
      .slice(0, MAX_MENTION_NOTIFY);
    if (!mentioned.length) return;

    const { data: actor } = await opts.db.from("profiles").select("display_name, username").eq("id", opts.actorId).maybeSingle();
    const who = actor?.display_name ?? (actor?.username ? `@${actor.username}` : "A manager");
    const body = opts.text.length > 140 ? `${opts.text.slice(0, 140)}…` : opts.text;

    // One notifyFantasy call per recipient (not batched): the dedupe key
    // carries the RECIPIENT's id (AC4's `mention:<id>:<userId>` shape), which
    // notifyFantasy's single dedupeKey-per-call can't express for a mixed
    // batch — five separate best-effort calls is the honest way to get that.
    for (const m of mentioned) {
      await notifyFantasy({
        userIds: [m.id],
        title: `${who} mentioned you`,
        body,
        url: opts.url,
        dedupeKey: `mention:${opts.dedupeSubjectId}:${m.id}`,
        type: "social_mention",
        actorId: opts.actorId,
      });
    }
  } catch (e) { console.error("[mentions] notify failed:", e); }
}

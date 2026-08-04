import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEngagementEmail } from "@/lib/email/senders";

/**
 * The engagement email fallback for people who don't have the app (founder, 4 Aug).
 *
 * Twitter-style events (a like, a reply, a reaction on your post) already write an
 * inbox row and push to app users. This layer reaches everyone ELSE by email:
 *
 *   • First 2 a day  → an individual email the moment it happens.
 *   • Everything after → left held (emailed_at NULL) for the end-of-day digest,
 *     which sends ONE summary + a rundown of their feed (see cron/engagement-digest).
 *
 * "Doesn't have the app" = no device_tokens row, the exact signal gameday uses for
 * its own email fallback — so nobody the push already reached is emailed twice.
 *
 * Everything here is best-effort and NEVER throws: an email failure must never take
 * down the like/reply/reaction it rides on. Ships DARK behind ENGAGEMENT_EMAILS_ENABLED.
 */

/** Engagement notification types the email layer owns (immediate + digest). */
export const ENGAGEMENT_TYPES = ["comment_like", "comment_reply", "feed_reaction"] as const;

/** Max individual emails a non-app user gets in a day before the rest are digested. */
const DAILY_IMMEDIATE_CAP = 2;

const svc = () => createServiceClient() as unknown as SupabaseClient;

/** UTC midnight ISO — the boundary for "today" (matches the cron's day window). */
export function startOfUtcDayIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** True if the user has NO native push token — i.e. email is their only channel. */
export async function isNonAppUser(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from("device_tokens").select("user_id").eq("user_id", userId).limit(1);
  return ((data ?? []) as unknown[]).length === 0;
}

/** Resolve a user's email, dropping suppressed addresses. Null = don't send. */
async function deliverableEmail(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (!email || !data?.user?.email_confirmed_at) return null;
  const { data: sup } = await db.from("email_suppressions").select("email").eq("email", email).limit(1);
  if (((sup ?? []) as unknown[]).length > 0) return null;
  return email;
}

/**
 * Decide whether to email a non-app recipient about a single engagement event NOW.
 * Called AFTER the inbox row is written, with that row's id so we can stamp it.
 *
 *   flag off / app user / no deliverable email  → no-op
 *   under the daily cap                         → send now, stamp emailed_at
 *   over the cap                                → leave held for the digest
 */
export async function dispatchEngagementEmail(opts: {
  userId: string;
  notifId: string;
  kind: "like" | "reply" | "reaction";
  actorName: string;
  snippet: string;
  url: string;
}): Promise<void> {
  try {
    if (process.env.ENGAGEMENT_EMAILS_ENABLED !== "true") return;
    const db = svc();

    if (!(await isNonAppUser(db, opts.userId))) return; // app user — push covers them

    // How many individual engagement emails has this user had TODAY?
    const dayStart = startOfUtcDayIso();
    const { count } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", opts.userId)
      .not("emailed_at", "is", null)
      .gte("emailed_at", dayStart);
    if ((count ?? 0) >= DAILY_IMMEDIATE_CAP) return; // over cap — digest owns the rest

    const email = await deliverableEmail(db, opts.userId);
    if (!email) return;

    // CLAIM the row: stamp only the null→now transition and require it to have
    // matched. This is the send guard — a re-like on an already-emailed aggregate
    // row matches nothing here and returns, so it never re-sends. Stamping before
    // the send also means a send failure just misses one email, never double-sends.
    const { data: claimed, error: stampErr } = await db
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", opts.notifId)
      .is("emailed_at", null)
      .select("id");
    if (stampErr) return;
    if (!claimed || (claimed as unknown[]).length === 0) return; // already emailed

    await sendEngagementEmail({
      userId: opts.userId,
      email,
      kind: opts.kind,
      actorName: opts.actorName,
      snippet: opts.snippet,
      url: opts.url,
    });
  } catch (err) {
    console.error("[engagement] dispatchEngagementEmail failed:", err);
  }
}

/**
 * A feed post got a reaction. Aggregates into ONE inbox row per post
 * (notifications_feed_react_agg_idx unique on subject_id where type='feed_reaction'):
 * count+1, actor swapped to the latest reactor, updated_at bumped so it resurfaces
 * as unread. Then hands the non-app author to the email fallback. Skips self.
 *
 * Fixes the gap where liking a feed post reached NOBODY — no inbox, no push, nothing.
 */
export async function recordFeedReaction(opts: {
  eventId: string;
  actorId: string;
  emoji: string;
}): Promise<void> {
  try {
    const db = svc();

    // Who owns the post? Also gives us the snippet + skip-self.
    const { data: ev } = await db
      .from("fantasy_feed_events")
      .select("actor_id, type, payload")
      .eq("id", opts.eventId)
      .maybeSingle();
    const authorId = (ev?.actor_id as string | undefined) ?? null;
    if (!authorId || authorId === opts.actorId) return;

    const url = `/fantasy/social?e=${opts.eventId}`;
    let notifId: string | null = null;

    const { data: existing } = await db
      .from("notifications")
      .select("id, like_count")
      .eq("subject_id", opts.eventId)
      .eq("type", "feed_reaction")
      .maybeSingle();

    if (existing) {
      notifId = existing.id as string;
      await db
        .from("notifications")
        .update({
          like_count: (existing.like_count as number) + 1,
          actor_id: opts.actorId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      const { data: ins } = await db
        .from("notifications")
        .insert({
          user_id: authorId,
          type: "feed_reaction",
          actor_id: opts.actorId,
          subject_type: "fantasy_feed",
          subject_id: opts.eventId,
          like_count: 1,
          url,
        })
        .select("id")
        .single();
      notifId = (ins?.id as string | undefined) ?? null;
    }

    if (!notifId) return;

    const actorName = await displayNameOf(db, opts.actorId);
    await dispatchEngagementEmail({
      userId: authorId,
      notifId,
      kind: "reaction",
      actorName,
      snippet: feedSnippet(ev?.type as string | undefined, ev?.payload),
      url,
    });
  } catch (err) {
    console.error("[engagement] recordFeedReaction failed:", err);
  }
}

/**
 * A reaction was removed. Count−1 WITHOUT bumping updated_at (a read notification
 * must never resurface from an un-react). Row deleted once the count hits 0.
 * Mirrors removeCommentLike.
 */
export async function removeFeedReaction(opts: { eventId: string }): Promise<void> {
  try {
    const db = svc();
    const { data: existing } = await db
      .from("notifications")
      .select("id, like_count")
      .eq("subject_id", opts.eventId)
      .eq("type", "feed_reaction")
      .maybeSingle();
    if (!existing) return;
    const next = (existing.like_count as number) - 1;
    if (next <= 0) await db.from("notifications").delete().eq("id", existing.id);
    else await db.from("notifications").update({ like_count: next }).eq("id", existing.id);
  } catch (err) {
    console.error("[engagement] removeFeedReaction failed:", err);
  }
}

/** Display name for an actor, falling back to @username then a generic. */
export async function displayNameOf(db: SupabaseClient, userId: string): Promise<string> {
  const { data } = await db.from("profiles").select("display_name, username").eq("id", userId).maybeSingle();
  const dn = (data?.display_name as string | undefined)?.trim();
  if (dn) return dn;
  const un = (data?.username as string | undefined)?.trim();
  return un ? `@${un}` : "A manager";
}

/** A short human label for what a feed event was, used in the email snippet. */
function feedSnippet(type: string | undefined, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const text = (p.text as string | undefined)?.trim();
  if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  switch (type) {
    case "post": return "your post";
    case "transfer": return "your transfer";
    case "captain": return "your captain pick";
    case "chip": return "your chip play";
    case "haul": return "your gameweek haul";
    case "rank_jump": return "your rank jump";
    default: return "your post";
  }
}

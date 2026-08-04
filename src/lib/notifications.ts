import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { dispatchEngagementEmail } from "@/lib/engagement";

/**
 * In-app notification inbox writers (stage 2). Service-role, best-effort —
 * modeled on notifyUsers() in @/lib/notify: full try/catch, console.error on
 * failure, NEVER throws. A notification failure must never fail the like or
 * reply it's attached to, so callers ignore the return value.
 *
 * `notifications` and `profiles.notifications_read_at` post-date the
 * generated src/types/database.ts (migration 222) — same untyped-client cast
 * used elsewhere in this workstream (comments.parent_id, club_supporters).
 */

const NOTIFIABLE_SUBJECT_TYPES = new Set(["pack", "debate"]);

/** Deep-link url for a comment, shared by the inbox row and the push payload.
 *  debate → /debate?c=<commentId>; pack → /play/pack/<subjectId>?c=<commentId>. */
export function commentDeepLink(subjectType: string, subjectId: string, commentId: string): string {
  if (subjectType === "pack") return `/play/pack/${subjectId}?c=${commentId}`;
  if (subjectType === "debate") return `/debate?c=${commentId}`;
  // Unreachable today (callers guard on pack|debate), but never mint a
  // confident-looking debate link for a subject that is not a debate.
  return "/";
}

/** Truncate by CHARACTER, not UTF-16 unit: slicing mid surrogate pair would put
 *  a lone surrogate in a push body and render as mojibake on the lock screen. */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed); // Array.from, not spread: no downlevelIteration needed
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : trimmed;
}

/** Generic single-row insert — used for comment_reply rows and (via the
 *  crons) broadcast rows. Never throws. */
export async function createNotification(row: {
  userId: string | null;
  type: string;
  actorId?: string | null;
  commentId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  title?: string | null;
  body?: string | null;
  url: string;
  dedupeKey?: string | null;
}): Promise<string | null> {
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data, error } = await svc.from("notifications").insert({
      user_id: row.userId,
      type: row.type,
      actor_id: row.actorId ?? null,
      comment_id: row.commentId ?? null,
      subject_type: row.subjectType ?? null,
      subject_id: row.subjectId ?? null,
      title: row.title ?? null,
      body: row.body ?? null,
      url: row.url,
      dedupe_key: row.dedupeKey ?? null,
    }).select("id").single();
    if (error) { console.error("[notifications] createNotification insert failed:", error); return null; }
    return (data?.id as string | undefined) ?? null;
  } catch (err) {
    console.error("[notifications] createNotification failed:", err);
    return null;
  }
}

/**
 * A reply pushes its parent's author — EVERY reply, no throttle, no cap
 * (founder decision). dedupeKey is per-reply (`comment-reply:<replyId>`), so
 * only a genuine retry of the same reply insert dedups; two distinct replies
 * from the same actor to the same parent both push. Never notifies you of
 * your own reply — call sites already guard that (createNotification's
 * caller checks parentAuthorId !== user.id before either write).
 */
export async function pushCommentReply(opts: {
  replyId: string;
  replyBody: string;
  authorId: string;
  actorId: string;
  subjectType: string;
  subjectId: string;
}): Promise<void> {
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: actor } = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", opts.actorId)
      .maybeSingle();
    const name = (actor?.display_name as string | undefined) || "A player";
    const deepLink = commentDeepLink(opts.subjectType, opts.subjectId, opts.replyId);
    await notifyUsers({
      userIds: [opts.authorId],
      title: `${name} replied to you`,
      body: truncate(opts.replyBody, 120),
      url: deepLink,
      dedupeKey: `comment-reply:${opts.replyId}`,
    });
  } catch (err) {
    console.error("[notifications] pushCommentReply failed:", err);
  }
}

/**
 * Broadcast row for a daily cron (daily_game / daily_debate) — stored ONCE
 * (user_id null), visible to every user including web users with no device
 * token. Upserted against notifications_dedupe_idx (unique on dedupe_key)
 * with ignoreDuplicates, so a DST double-fire or retry for the same day
 * writes exactly one row. Wrap the call site in try/catch too — push must
 * proceed regardless of this succeeding.
 */
export async function upsertBroadcastNotification(row: {
  type: string;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
}): Promise<void> {
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { error } = await svc.from("notifications").upsert(
      {
        user_id: null,
        type: row.type,
        title: row.title,
        body: row.body,
        url: row.url,
        dedupe_key: row.dedupeKey,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (error) console.error("[notifications] upsertBroadcastNotification failed:", error);
  } catch (err) {
    console.error("[notifications] upsertBroadcastNotification failed:", err);
  }
}

/**
 * A comment got a new like. Aggregates into ONE row per comment
 * (notifications_like_agg_idx unique on comment_id where type='comment_like'):
 * count+1, actor swapped to the latest liker, updated_at bumped so it
 * resurfaces as unread and moves to the top. Skips self-likes and anything
 * outside pack/debate (fantasy_league chat is out of scope).
 *
 * Push (stage 3): FIRST like only, forever. The inbox row above is an
 * aggregate that a later unlike can delete and a relike recreate — the push
 * gate is deliberately separate, riding notification_log's own per-(user,key)
 * dedupe via notifyUsers, keyed `comment-like:<commentId>`. That log row is
 * never pruned for comment keys, so once the author has been pushed once,
 * they're never pushed again for this comment, even if the inbox row is
 * deleted (count → 0) and later resurrected by a new liker.
 */
export async function recordCommentLike(opts: {
  commentId: string;
  commentBody: string;
  authorId: string;
  actorId: string;
  subjectType: string;
  subjectId: string;
  url: string;
}): Promise<void> {
  if (opts.authorId === opts.actorId) return;
  if (!NOTIFIABLE_SUBJECT_TYPES.has(opts.subjectType)) return;
  let notifId: string | null = null;
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: existing } = await svc
      .from("notifications")
      .select("id, like_count")
      .eq("comment_id", opts.commentId)
      .eq("type", "comment_like")
      .maybeSingle();

    if (existing) {
      notifId = existing.id as string;
      const { error } = await svc
        .from("notifications")
        .update({
          like_count: (existing.like_count as number) + 1,
          actor_id: opts.actorId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) console.error("[notifications] recordCommentLike update failed:", error);
    } else {
      const { data: ins, error } = await svc.from("notifications").insert({
        user_id: opts.authorId,
        type: "comment_like",
        actor_id: opts.actorId,
        comment_id: opts.commentId,
        subject_type: opts.subjectType,
        subject_id: opts.subjectId,
        like_count: 1,
        url: opts.url,
      }).select("id").single();
      if (error) console.error("[notifications] recordCommentLike insert failed:", error);
      notifId = (ins?.id as string | undefined) ?? null;
    }
  } catch (err) {
    console.error("[notifications] recordCommentLike failed:", err);
  }

  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: actor } = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", opts.actorId)
      .maybeSingle();
    const name = (actor?.display_name as string | undefined) || "A player";
    const deepLink = commentDeepLink(opts.subjectType, opts.subjectId, opts.commentId);
    await notifyUsers({
      userIds: [opts.authorId],
      title: `${name} liked your comment`,
      body: truncate(opts.commentBody, 90),
      url: deepLink,
      dedupeKey: `comment-like:${opts.commentId}`,
    });
    // Email fallback for non-app authors (first 2 a day, rest digested). No-op
    // for app users and when the aggregate row already existed (only the first
    // like on a comment mints a fresh, un-emailed row worth an individual email).
    if (notifId) {
      await dispatchEngagementEmail({
        userId: opts.authorId,
        notifId,
        kind: "like",
        actorName: name,
        snippet: truncate(opts.commentBody, 90),
        url: deepLink,
      });
    }
  } catch (err) {
    console.error("[notifications] recordCommentLike push failed:", err);
  }
}

/**
 * A like was removed. Count−1 WITHOUT bumping updated_at (an already-read
 * notification must never resurface from an unlike). Row is deleted once the
 * count hits 0.
 */
export async function removeCommentLike(opts: { commentId: string }): Promise<void> {
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: existing } = await svc
      .from("notifications")
      .select("id, like_count")
      .eq("comment_id", opts.commentId)
      .eq("type", "comment_like")
      .maybeSingle();
    if (!existing) return;

    const nextCount = (existing.like_count as number) - 1;
    if (nextCount <= 0) {
      const { error } = await svc.from("notifications").delete().eq("id", existing.id);
      if (error) console.error("[notifications] removeCommentLike delete failed:", error);
    } else {
      const { error } = await svc
        .from("notifications")
        .update({ like_count: nextCount })
        .eq("id", existing.id);
      if (error) console.error("[notifications] removeCommentLike update failed:", error);
    }
  } catch (err) {
    console.error("[notifications] removeCommentLike failed:", err);
  }
}

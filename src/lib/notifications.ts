import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

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
}): Promise<void> {
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { error } = await svc.from("notifications").insert({
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
    });
    if (error) console.error("[notifications] createNotification insert failed:", error);
  } catch (err) {
    console.error("[notifications] createNotification failed:", err);
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
 */
export async function recordCommentLike(opts: {
  commentId: string;
  authorId: string;
  actorId: string;
  subjectType: string;
  subjectId: string;
  url: string;
}): Promise<void> {
  if (opts.authorId === opts.actorId) return;
  if (!NOTIFIABLE_SUBJECT_TYPES.has(opts.subjectType)) return;
  try {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: existing } = await svc
      .from("notifications")
      .select("id, like_count")
      .eq("comment_id", opts.commentId)
      .eq("type", "comment_like")
      .maybeSingle();

    if (existing) {
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
      const { error } = await svc.from("notifications").insert({
        user_id: opts.authorId,
        type: "comment_like",
        actor_id: opts.actorId,
        comment_id: opts.commentId,
        subject_type: opts.subjectType,
        subject_id: opts.subjectId,
        like_count: 1,
        url: opts.url,
      });
      if (error) console.error("[notifications] recordCommentLike insert failed:", error);
    }
  } catch (err) {
    console.error("[notifications] recordCommentLike failed:", err);
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

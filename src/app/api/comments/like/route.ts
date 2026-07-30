import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { recordCommentLike, removeCommentLike } from "@/lib/notifications";

// Like/unlike a discussion comment. Idempotent — upsert on like, plain
// delete on unlike. Comments are world-readable, so existence is checked
// via the user-session client rather than service role.

export const fetchCache = "force-no-store";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

async function parseCommentId(req: NextRequest): Promise<string | null> {
  const payload = await req.json().catch(() => null);
  const commentId = typeof payload?.commentId === "string" ? payload.commentId : "";
  return commentId || null;
}

/** POST /api/comments/like { commentId } */
export async function POST(req: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in to like comments" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`comment-likes:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down a little" }, { status: 429 });

  const commentId = await parseCommentId(req);
  if (!commentId) return NextResponse.json({ error: "Missing comment" }, { status: 400 });

  // Widened beyond `id` so the notification path below can derive the
  // recipient (user_id) and enforce the pack/debate guard (subject_type) —
  // a like on a fantasy_league comment must write zero notification rows.
  const { data: comment } = await supabase
    .from("comments")
    .select("id, subject_type, subject_id, user_id")
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "That comment is gone" }, { status: 404 });

  const { error } = await supabase
    .from("comment_likes")
    .upsert({ comment_id: commentId, user_id: user.id }, { onConflict: "comment_id,user_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });

  // Never fail the like on a notification error — recordCommentLike never
  // throws, and itself skips self-likes and non pack/debate subjects.
  await recordCommentLike({
    commentId,
    authorId: comment.user_id,
    actorId: user.id,
    subjectType: comment.subject_type,
    subjectId: comment.subject_id,
    url: comment.subject_type === "pack" ? "/play" : "/debate",
  });

  return NextResponse.json({ ok: true });
}

/** DELETE /api/comments/like { commentId } */
export async function DELETE(req: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in to like comments" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`comment-likes:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down a little" }, { status: 429 });

  const commentId = await parseCommentId(req);
  if (!commentId) return NextResponse.json({ error: "Missing comment" }, { status: 400 });

  const { data: comment } = await supabase
    .from("comments")
    .select("id, subject_type, subject_id, user_id")
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "That comment is gone" }, { status: 404 });

  const { error } = await supabase
    .from("comment_likes")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });

  // Decrement (or delete once count hits 0). Never bumps updated_at — an
  // already-read notification must never resurface from an unlike.
  await removeCommentLike({ commentId });

  return NextResponse.json({ ok: true });
}

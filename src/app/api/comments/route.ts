import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { commentRejection } from "@/lib/moderation";
import { createNotification, pushCommentReply, commentDeepLink } from "@/lib/notifications";

// comments.parent_id and club_supporters are additive/not yet in the
// generated src/types/database.ts — same untyped-client cast used across the
// halftime/club-fan workstream (src/lib/clubs/query.ts) for this exact reason.

// Discussion threads on quiz packs and debates. Two-level (IG-style) replies:
// newest 50 TOP-LEVEL comments, plus every live reply under those 50 in one
// batched query. comments has NO FK to profiles (same as league_members) —
// author info is a second fetch, never an embedded select.

const SUBJECT_TYPES = new Set(["pack", "debate"]);

export const fetchCache = "force-no-store"; // live threads — see debate/today/route.ts

export interface CommentRow {
  id: string;
  parentId: string | null;
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** club_supporters.club for the commenter's latest season row, or null if
   *  they have none — the client renders no crest (and no placeholder) then. */
  club: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  /** A top-level comment that was deleted but still has live replies beneath
   *  it. Rendered as a muted "Comment deleted" row: no avatar link, no like,
   *  no reply button, no crest — replies stay intact. Never true for a reply
   *  (a deleted reply is just dropped, same as before). */
  deleted?: boolean;
}

/** GET /api/comments?type=pack|debate&id=<uuid> — newest 50 top-level + all
 *  their live replies + total. */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "";
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!SUBJECT_TYPES.has(type) || !id) {
    return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
  }

  // Unauthenticated + several service-role queries per call on three hot
  // screens — rate-limit per IP so an anonymous loop can't amplify Supabase IO.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok } = await rateLimitDistributed(`comments-get:${ip}`, 30, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const svc = createServiceClient() as unknown as SupabaseClient;

  // `total` is decoupled from pagination: ALL live rows (top-level + replies)
  // for the subject, via a head-only count. Optimistic insert/delete on the
  // client does total±1 to match this exactly.
  const totalPromise = svc
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("subject_type", type)
    .eq("subject_id", id)
    .is("deleted_at", null);

  // Top-level page WITHOUT the deleted filter — a deleted parent with live
  // replies must still surface as a tombstone. Pruning of deleted-with-no-
  // replies happens below, in JS, as an explicit branch.
  const topPromise = svc
    .from("comments")
    .select("id, user_id, body, created_at, deleted_at")
    .eq("subject_type", type)
    .eq("subject_id", id)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const [{ count: total }, { data: topRows }] = await Promise.all([totalPromise, topPromise]);

  type TopRow = { id: string; user_id: string; body: string; created_at: string; deleted_at: string | null };
  type ReplyRow = { id: string; parent_id: string; user_id: string; body: string; created_at: string };

  const topIds = (topRows ?? []).map((r) => r.id);
  const { data: replyRows } = topIds.length
    ? await svc
        .from("comments")
        .select("id, parent_id, user_id, body, created_at")
        .in("parent_id", topIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [] as ReplyRow[] };
  const replies: ReplyRow[] = replyRows ?? [];

  const repliesByParent = new Map<string, ReplyRow[]>();
  for (const r of replies) {
    const list = repliesByParent.get(r.parent_id) ?? [];
    list.push(r);
    repliesByParent.set(r.parent_id, list);
  }

  // Explicit prune branch: a deleted top-level row with zero live replies is
  // dropped entirely (today's behaviour). One with live replies survives as
  // a tombstone. ONE ordered pass — the client renders top-level in array
  // order, so tombstones must keep their created_at position in the thread
  // rather than being grouped at the end.
  const topOrdered: { row: TopRow; deleted: boolean }[] = [];
  for (const r of (topRows ?? []) as TopRow[]) {
    if (!r.deleted_at) {
      topOrdered.push({ row: r, deleted: false });
    } else if ((repliesByParent.get(r.id)?.length ?? 0) > 0) {
      topOrdered.push({ row: r, deleted: true });
    }
    // else: deleted, no replies — pruned, matches pre-replies behaviour.
  }
  const liveTop = topOrdered.filter((t) => !t.deleted).map((t) => t.row);

  const userIds = Array.from(new Set([
    ...liveTop.map((r) => r.user_id),
    ...replies.map((r) => r.user_id),
  ]));
  const [{ data: profiles }, { data: supporterRows }] = await Promise.all([
    userIds.length
      ? svc.from("profiles").select("id, display_name, avatar_url").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] }),
    userIds.length
      ? svc.from("club_supporters").select("user_id, club, season_id").in("user_id", userIds).order("season_id", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] as { user_id: string; club: string; season_id: number }[] }),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  // First row per user wins — rows are ordered season_id DESC, so that's the
  // latest season's club (see brief: don't use currentSeasonId(), it can null).
  // The explicit 1000 matches PostgREST's hard response cap: because the order
  // is season_id desc, a truncation drops the OLDEST rows first — exactly the
  // ones this loop would discard anyway — so the "latest per user" answer holds.
  const clubById = new Map<string, string>();
  for (const s of supporterRows ?? []) {
    if (!clubById.has(s.user_id)) clubById.set(s.user_id, s.club);
  }

  const commentIds = [...liveTop.map((r) => r.id), ...replies.map((r) => r.id)];
  const countById = new Map<string, number>();
  const likedIds = new Set<string>();
  if (commentIds.length) {
    // Known scale ceiling: PostgREST caps a response at 1000 rows no matter
    // what .limit() says, so this tally undercounts once a page of comments
    // holds >1000 likes between them. Fine at today's volumes; the upgrade
    // path is a count RPC (or a per-comment aggregate), not a bigger limit.
    const { data: likeRows } = await svc
      .from("comment_likes")
      .select("comment_id")
      .in("comment_id", commentIds)
      .limit(1000);
    for (const l of likeRows ?? []) {
      countById.set(l.comment_id, (countById.get(l.comment_id) ?? 0) + 1);
    }
    if (user) {
      const { data: mine } = await svc
        .from("comment_likes")
        .select("comment_id")
        .in("comment_id", commentIds)
        .eq("user_id", user.id)
        .limit(1000);
      for (const l of mine ?? []) likedIds.add(l.comment_id);
    }
  }

  const liveRow = (r: { id: string; user_id: string; body: string; created_at: string }, parentId: string | null): CommentRow => ({
    id: r.id,
    parentId,
    userId: r.user_id,
    name: profileById.get(r.user_id)?.display_name ?? "A player",
    avatarUrl: profileById.get(r.user_id)?.avatar_url ?? null,
    club: clubById.get(r.user_id) ?? null,
    body: r.body,
    createdAt: r.created_at,
    likeCount: countById.get(r.id) ?? 0,
    likedByMe: likedIds.has(r.id),
  });

  // Top-level emitted in query order (created_at desc), tombstones inline in
  // their real position. A tombstone carries NO identifying fields — not even
  // userId — so a soft-deleted comment can't be attributed to its author from
  // the response payload.
  const comments: CommentRow[] = [
    ...topOrdered.map(({ row, deleted }) =>
      deleted
        ? {
            id: row.id,
            parentId: null,
            userId: "",
            name: "",
            avatarUrl: null,
            club: null,
            body: "",
            createdAt: row.created_at,
            likeCount: 0,
            likedByMe: false,
            deleted: true,
          }
        : liveRow(row, null),
    ),
    ...replies.map((r) => liveRow(r, r.parent_id as string)),
  ];

  // likedByMe is per-user, so this response must never be shared across
  // users by an edge/CDN cache (which keys on URL, not cookie).
  return NextResponse.json(
    { comments, total: total ?? comments.length },
    { headers: { "cache-control": "private, no-store" } },
  );
}

/** POST /api/comments { subjectType, subjectId, body, parentId? } — parentId
 *  makes this a reply. Replies share the same 8/min bucket as top-level
 *  posts, and are auth-gated only (never canPost-gated — see DiscussionThread). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to join the discussion" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`comments:${user.id}`, 8, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down a little" }, { status: 429 });

  const payload = await req.json().catch(() => null);
  const type = typeof payload?.subjectType === "string" ? payload.subjectType : "";
  const id = typeof payload?.subjectId === "string" ? payload.subjectId : "";
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  const parentId = typeof payload?.parentId === "string" && payload.parentId ? payload.parentId : null;
  if (!SUBJECT_TYPES.has(type) || !id) return NextResponse.json({ error: "Missing subject" }, { status: 400 });
  if (!body || body.length > 280) return NextResponse.json({ error: "Comments are 1–280 characters" }, { status: 400 });

  const rejection = commentRejection(body);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

  // Validate the parent via service role and return a clean 400 for the
  // user-facing cases the DB trigger also guards (belt-and-braces — the
  // trigger is the structural backstop, this is the friendly error path).
  // user_id is fetched here too — the reply author it belongs to is the
  // notification recipient below, so no second lookup after insert.
  let parentAuthorId: string | null = null;
  if (parentId) {
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: parent } = await svc
      .from("comments")
      .select("id, parent_id, subject_type, subject_id, deleted_at, user_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: "That comment doesn't exist anymore" }, { status: 400 });
    if (parent.parent_id) return NextResponse.json({ error: "Replies are only one level deep" }, { status: 400 });
    if (parent.deleted_at) return NextResponse.json({ error: "Can't reply to a deleted comment" }, { status: 400 });
    if (parent.subject_type !== type || parent.subject_id !== id) {
      return NextResponse.json({ error: "That comment isn't part of this thread" }, { status: 400 });
    }
    parentAuthorId = parent.user_id;
  }

  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from("comments")
    .insert({ subject_type: type, subject_id: id, user_id: user.id, body, parent_id: parentId })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not post — try again" }, { status: 500 });

  // Notify the parent's author, never yourself. type is already restricted to
  // pack/debate by SUBJECT_TYPES above. A notification failure must never
  // fail the reply — createNotification and pushCommentReply never throw.
  // Inbox write first, then push (stage 3 ordering — a push failure must
  // never take the inbox row down with it).
  if (parentAuthorId && parentAuthorId !== user.id) {
    const deepLink = commentDeepLink(type, id, data.id);
    await createNotification({
      userId: parentAuthorId,
      type: "comment_reply",
      actorId: user.id,
      commentId: data.id,
      subjectType: type,
      subjectId: id,
      url: deepLink,
    });
    await pushCommentReply({
      replyId: data.id,
      replyBody: body,
      authorId: parentAuthorId,
      actorId: user.id,
      subjectType: type,
      subjectId: id,
    });
  }

  return NextResponse.json({ id: data.id, createdAt: data.created_at, parentId });
}

/** DELETE /api/comments { id } — soft-delete your own comment. */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  const id = typeof payload?.id === "string" ? payload.id : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Service role for the write: a soft-deleted row no longer satisfies the
  // SELECT policy (deleted_at is null), and PostgREST applies that policy to
  // the post-update row — so an author-session update 42501s. Ownership is
  // enforced here instead.
  const svc = createServiceClient();
  const { data: own } = await svc.from("comments").select("user_id").eq("id", id).maybeSingle();
  if (!own || own.user_id !== user.id) return NextResponse.json({ error: "Not your comment" }, { status: 403 });

  const { error } = await svc.from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

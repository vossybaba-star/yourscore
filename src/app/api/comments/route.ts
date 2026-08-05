import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { commentRejection } from "@/lib/moderation";
import { createNotification, pushCommentReply, commentDeepLink } from "@/lib/notifications";
import { dispatchEngagementEmail, displayNameOf } from "@/lib/engagement";
import { extractMentions, resolveUsernames, resolveMentionEntities, type MentionEntity } from "@/lib/mentions";
import { notifyMentions } from "@/lib/fantasy/mentions";
import { hiddenActorIds } from "@/lib/social/safety";
import { HttpError } from "@/lib/fantasy/server";
import { parseVideoAttachment, isPostVideoUrl, type FeedVideo } from "@/lib/fantasy/feed";

// comments.parent_id and club_supporters are additive/not yet in the
// generated src/types/database.ts — same untyped-client cast used across the
// halftime/club-fan workstream (src/lib/clubs/query.ts) for this exact reason.

// Discussion threads on quiz packs and debates. Two-level (IG-style) replies:
// newest 50 TOP-LEVEL comments, plus every live reply under those 50 in one
// batched query. comments has NO FK to profiles (same as league_members) —
// author info is a second fetch, never an embedded select.

const SUBJECT_TYPES = new Set(["pack", "debate", "fantasy_feed"]);

export const fetchCache = "force-no-store"; // live threads — see debate/today/route.ts

/** A comment row's own validated payload.mentions (Phase 1A), or null for a
 *  legacy row (written before Phase 1A, or a hand-typed handle with no
 *  stored entities) — the caller falls back to the regex+resolve batch for
 *  those. Malformed entries are dropped rather than thrown on. */
function storedMentionsOf(payload: unknown): MentionEntity[] | null {
  const raw = (payload as { mentions?: unknown } | null)?.mentions;
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: MentionEntity[] = [];
  for (const r of raw as unknown[]) {
    const e = r as { userId?: unknown; usernameSnapshot?: unknown };
    if (typeof e?.userId === "string" && typeof e?.usernameSnapshot === "string") {
      out.push({ userId: e.userId, usernameSnapshot: e.usernameSnapshot });
    }
  }
  return out.length ? out : null;
}

/** A comment row's own payload.video (Phase 2c, video replies) — re-validated
 *  on the way OUT the same way postToFeed's video is checked on the way IN
 *  (isPostVideoUrl), so a hand-crafted row can't smuggle an arbitrary
 *  external video into a thread just because it once passed the POST check. */
function videoOf(payload: unknown): FeedVideo | null {
  const raw = (payload as { video?: unknown } | null)?.video;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { url?: unknown; posterUrl?: unknown; width?: unknown; height?: unknown; durationMs?: unknown };
  const url = typeof v.url === "string" ? v.url : "";
  if (!isPostVideoUrl(url)) return null;
  const width = Number(v.width) || 0;
  const height = Number(v.height) || 0;
  const durationMs = Number(v.durationMs) || 0;
  if (!width || !height || !durationMs) return null;
  return { url, posterUrl: typeof v.posterUrl === "string" ? v.posterUrl : null, width, height, durationMs };
}

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
  /** An optional video attached to this comment/reply (native video upload,
   *  Phase 2c) — validated identically to a post's own video. Null for every
   *  comment written before this phase, or one with no video. */
  video?: FeedVideo | null;
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
    .select("id, user_id, body, created_at, deleted_at, payload")
    .eq("subject_type", type)
    .eq("subject_id", id)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const [{ count: total }, { data: topRows }] = await Promise.all([totalPromise, topPromise]);

  type TopRow = { id: string; user_id: string; body: string; created_at: string; deleted_at: string | null; payload: unknown };
  type ReplyRow = { id: string; parent_id: string; user_id: string; body: string; created_at: string; payload: unknown };

  const topIds = (topRows ?? []).map((r) => r.id);
  const { data: replyRows } = topIds.length
    ? await svc
        .from("comments")
        .select("id, parent_id, user_id, body, created_at, payload")
        .in("parent_id", topIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [] as ReplyRow[] };
  const replies: ReplyRow[] = replyRows ?? [];

  // Block/mute filtering (Phase 5a review pass): a blocked or muted author's
  // comments vanish from the viewer's threads on every subject type — a block
  // that leaves their replies visible under your posts isn't a block. Hidden
  // replies are dropped outright; a hidden TOP-LEVEL row is treated like a
  // soft-deleted one below (tombstone if others replied, pruned otherwise) so
  // real people's replies never orphan.
  const hidden = user ? await hiddenActorIds(svc, user.id) : new Set<string>();
  const visibleReplies = hidden.size ? replies.filter((r) => !hidden.has(r.user_id)) : replies;

  const repliesByParent = new Map<string, ReplyRow[]>();
  for (const r of visibleReplies) {
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
    const hiddenAuthor = hidden.has(r.user_id);
    if (!r.deleted_at && !hiddenAuthor) {
      topOrdered.push({ row: r, deleted: false });
    } else if ((repliesByParent.get(r.id)?.length ?? 0) > 0) {
      topOrdered.push({ row: r, deleted: true });
    }
    // else: deleted or hidden, no live replies — pruned.
  }
  const liveTop = topOrdered.filter((t) => !t.deleted).map((t) => t.row);

  const userIds = Array.from(new Set([
    ...liveTop.map((r) => r.user_id),
    ...visibleReplies.map((r) => r.user_id),
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

  const commentIds = [...liveTop.map((r) => r.id), ...visibleReplies.map((r) => r.id)];
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

  const liveRow = (r: { id: string; user_id: string; body: string; created_at: string; payload?: unknown }, parentId: string | null): CommentRow => ({
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
    video: videoOf(r.payload),
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

  // Mentions (Phase 3b regex fallback / Phase 1A stored entities, AC3) —
  // prefer each comment's own validated payload.mentions (no resolve
  // needed); only a LEGACY row (no stored entities) falls into the batch
  // regex+resolve, same shape as the feed's own hydrateEvents. Comments
  // carry no subject-specific gating here — a debate or pack comment can
  // mention someone too, it just doesn't NOTIFY them (that hook is
  // fantasy_feed-only, see POST below). One flattened map is returned (not
  // per-comment) — the client just needs @handle -> userId to linkify, and
  // usernames are unique case-insensitively, so a single map covers every
  // comment on the page regardless of which path resolved it.
  const mentionMap = new Map<string, { id: string; username: string }>();
  const legacyBodies: string[] = [];
  for (const r of [...liveTop, ...visibleReplies]) {
    const stored = storedMentionsOf(r.payload);
    if (stored) {
      for (const e of stored) mentionMap.set(e.usernameSnapshot.toLowerCase(), { id: e.userId, username: e.usernameSnapshot });
    } else {
      legacyBodies.push(r.body);
    }
  }
  const legacyHandles = extractMentions(legacyBodies.join(" \n "));
  if (legacyHandles.length) {
    const resolved = await resolveUsernames(svc, legacyHandles);
    resolved.forEach((u, h) => { if (!mentionMap.has(h)) mentionMap.set(h, u); });
  }
  const mentionedUsers = Array.from(mentionMap.values());

  // likedByMe is per-user, so this response must never be shared across
  // users by an edge/CDN cache (which keys on URL, not cookie).
  return NextResponse.json(
    { comments, total: total ?? comments.length, mentionedUsers },
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
  if (body.length > 280) return NextResponse.json({ error: "Comments are 1–280 characters" }, { status: 400 });

  // A video attachment (native video upload, Phase 2c) — validated EXACTLY
  // like postToFeed's own video, via the same shared parseVideoAttachment. A
  // comment/reply can carry text, a video, or both — but needs at least one.
  let video: FeedVideo | null;
  try {
    video = parseVideoAttachment(payload?.video);
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (!body && !video) return NextResponse.json({ error: "Comments are 1–280 characters" }, { status: 400 });

  const rejection = body ? commentRejection(body) : null;
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

  // Service role for the parent check AND mention validation below — one
  // client, created once regardless of whether this is a reply.
  const svc = createServiceClient() as unknown as SupabaseClient;

  // Validate the parent via service role and return a clean 400 for the
  // user-facing cases the DB trigger also guards (belt-and-braces — the
  // trigger is the structural backstop, this is the friendly error path).
  // user_id is fetched here too — the reply author it belongs to is the
  // notification recipient below, so no second lookup after insert.
  let parentAuthorId: string | null = null;
  if (parentId) {
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

  // Structured mentions (Phase 1A) — validate whatever the composer tagged
  // against the body + current DB ownership, merged with any @handle the
  // user hand-typed without picking from autocomplete. One batch query,
  // stored on THIS comment's own payload.mentions regardless of subject type
  // (a debate/pack comment can carry a mention too — it just doesn't notify,
  // same rule the GET handler's own comment already documents).
  const mentionEntities = body ? await resolveMentionEntities(svc, body, payload?.mentions) : [];

  // comments.body has a NOT NULL length-between-1-and-280 check (migration
  // 70) — an empty-text video-only comment/reply stores a single space to
  // satisfy it. The client trims before deciding whether to render a text
  // line, so this placeholder is never shown; every notification/preview
  // below is built from `body` (the real submitted text), never this.
  const dbBody = body || " ";
  const insertPayload: Record<string, unknown> = {};
  if (mentionEntities.length) insertPayload.mentions = mentionEntities;
  if (video) insertPayload.video = video;

  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from("comments")
    .insert({
      subject_type: type, subject_id: id, user_id: user.id, body: dbBody, parent_id: parentId,
      ...(Object.keys(insertPayload).length ? { payload: insertPayload } : {}),
    })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not post — try again" }, { status: 500 });

  // A notification/email preview built from empty text would read as blank
  // (Phase 2c, AC6) — a video-only comment/reply previews as "a video"
  // instead, same idea as chat's own "shared a video" summary.
  const previewText = body || (video ? "a video" : "");

  // Notify the parent's author, never yourself. type is already restricted to
  // pack/debate by SUBJECT_TYPES above. A notification failure must never
  // fail the reply — createNotification and pushCommentReply never throw.
  // Inbox write first, then push (stage 3 ordering — a push failure must
  // never take the inbox row down with it).
  if (parentAuthorId && parentAuthorId !== user.id) {
    const deepLink = commentDeepLink(type, id, data.id);
    const notifId = await createNotification({
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
      replyBody: previewText,
      authorId: parentAuthorId,
      actorId: user.id,
      subjectType: type,
      subjectId: id,
    });
    // Email fallback for a non-app parent author (first 2 a day, rest digested).
    if (notifId) {
      const actorName = await displayNameOf(svc, user.id);
      await dispatchEngagementEmail({
        userId: parentAuthorId,
        notifId,
        kind: "reply",
        actorName,
        snippet: previewText.length > 90 ? `${previewText.slice(0, 90)}…` : previewText,
        url: deepLink,
      });
    }
  }

  // Mention notifications (Phase 3b, AC4) — fantasy_feed comments/replies
  // only (pack/debate comments don't carry this yet). Fire-and-forget, same
  // as everything else on this path — a mention notify must never fail the
  // comment post. `id` here is the fantasy_feed subject id, i.e. the post's
  // own event id — the notification's tap target.
  if (type === "fantasy_feed") {
    void notifyMentions({
      db: svc,
      text: body,
      actorId: user.id,
      dedupeSubjectId: data.id,
      url: `/fantasy/social/post/${id}`,
      entities: mentionEntities,
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

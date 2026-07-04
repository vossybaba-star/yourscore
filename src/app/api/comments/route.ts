import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { commentRejection } from "@/lib/moderation";

// Discussion threads on quiz packs and debates. One flat thread per subject,
// newest first, 280-char comments. comments has NO FK to profiles (same as
// league_members) — author info is a second fetch, never an embedded select.

const SUBJECT_TYPES = new Set(["pack", "debate"]);

export interface CommentRow {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
}

/** GET /api/comments?type=pack|debate&id=<uuid> — newest 50 + total. */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "";
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!SUBJECT_TYPES.has(type) || !id) {
    return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: rows, count } = await svc
    .from("comments")
    .select("id, user_id, body, created_at", { count: "exact" })
    .eq("subject_type", type)
    .eq("subject_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  const { data: profiles } = userIds.length
    ? await svc.from("profiles").select("id, display_name, avatar_url").in("id", userIds)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const comments: CommentRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: byId.get(r.user_id)?.display_name ?? "A player",
    avatarUrl: byId.get(r.user_id)?.avatar_url ?? null,
    body: r.body,
    createdAt: r.created_at,
  }));
  return NextResponse.json({ comments, total: count ?? comments.length });
}

/** POST /api/comments { subjectType, subjectId, body } */
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
  if (!SUBJECT_TYPES.has(type) || !id) return NextResponse.json({ error: "Missing subject" }, { status: 400 });
  if (!body || body.length > 280) return NextResponse.json({ error: "Comments are 1–280 characters" }, { status: 400 });

  const rejection = commentRejection(body);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

  const { data, error } = await supabase
    .from("comments")
    .insert({ subject_type: type, subject_id: id, user_id: user.id, body })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not post — try again" }, { status: 500 });

  return NextResponse.json({ id: data.id, createdAt: data.created_at });
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

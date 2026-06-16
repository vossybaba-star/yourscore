import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createWcDb } from "@/lib/draft/wc-server";

// Comments on a World Cup ranked result/squad (WC-only social layer).
//   GET  ?user=<uuid>                         → every non-deleted comment on that player's runs
//   POST { action:"create", runId, body }     → add a comment (auth, 240-char cap, rate-limited)
//   POST { action:"delete", commentId }        → soft-delete (comment author OR the run's owner)
// Server-authoritative: the table is service-role only; auth/ownership is enforced here.

const MAX_LEN = 240;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const commentsOff = () => process.env.WC_COMMENTS_OFF === "1"; // admin kill-switch (set in Vercel)

export async function GET(req: NextRequest) {
  const user = new URL(req.url).searchParams.get("user") ?? "";
  if (!UUID_RE.test(user)) return NextResponse.json({ comments: [] });
  try {
    const db = createWcDb();
    const { data, error } = await db.rpc("get_wc_run_comments", { p_user: user });
    if (error) return NextResponse.json({ comments: [], ready: false });
    return NextResponse.json({ comments: data ?? [], ready: true });
  } catch {
    return NextResponse.json({ comments: [], ready: false });
  }
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to comment" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`wc-comment:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down a moment" }, { status: 429 });

  let body: { action?: string; runId?: string; commentId?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const db = createWcDb();

  if (body.action === "create") {
    if (commentsOff()) return NextResponse.json({ error: "Comments are temporarily off" }, { status: 403 });
    const runId = String(body.runId ?? "");
    const text = String(body.body ?? "").trim();
    if (!UUID_RE.test(runId)) return NextResponse.json({ error: "Unknown result" }, { status: 400 });
    if (text.length < 1 || text.length > MAX_LEN) return NextResponse.json({ error: `Keep it 1–${MAX_LEN} characters` }, { status: 400 });

    // The run must exist (FK also guards) — keep it tied to a real ranked result.
    const { data: run } = await db.from("draft_wc_runs").select("id").eq("id", runId).maybeSingle();
    if (!run) return NextResponse.json({ error: "Unknown result" }, { status: 404 });

    const { data: inserted, error } = await db.from("wc_run_comments")
      .insert({ run_id: runId, author_id: user.id, body: text })
      .select("id, created_at").single();
    if (error || !inserted) return NextResponse.json({ error: "Could not post comment" }, { status: 500 });

    const { data: prof } = await db.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle();
    return NextResponse.json({
      comment: {
        id: inserted.id, run_id: runId, author_id: user.id,
        author_name: (prof?.display_name as string) || "Player", author_avatar: (prof?.avatar_url as string) ?? null,
        body: text, created_at: inserted.created_at,
      },
    });
  }

  if (body.action === "delete") {
    const commentId = String(body.commentId ?? "");
    if (!UUID_RE.test(commentId)) return NextResponse.json({ error: "Unknown comment" }, { status: 400 });
    // Allowed if you wrote it OR you own the result it's on.
    const { data: c } = await db.from("wc_run_comments").select("author_id, run_id").eq("id", commentId).maybeSingle();
    if (!c) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    let allowed = c.author_id === user.id;
    if (!allowed) {
      const { data: run } = await db.from("draft_wc_runs").select("user_id").eq("id", c.run_id).maybeSingle();
      allowed = run?.user_id === user.id;
    }
    if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

    const { error } = await db.from("wc_run_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
    if (error) return NextResponse.json({ error: "Could not remove comment" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

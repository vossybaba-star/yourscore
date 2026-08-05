import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";

/**
 * Admin control surface for social_reports (Social Phase 5a, AC6). Gated the
 * SAME way every other /api/admin/* route is (requireAdmin — profiles'
 * app_metadata.is_admin, checked again here because the service-role write
 * below bypasses RLS). social_reports/user_blocks/user_mutes post-date the
 * generated Database types, same untyped-client idiom as scout-picks.
 *
 * GET  — every report, newest first, with a resolved subject preview.
 * POST { action: "dismiss", id } — clears the report, no other action.
 * POST { action: "hide", id }    — soft-hides the subject (the SAME flag a
 *   manager's own delete uses: payload.deleted for a post, deleted_at for a
 *   comment) then clears the report. Not offered for a profile report — there's
 *   nothing to soft-hide there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export const fetchCache = "force-no-store";

interface ReportRow {
  id: string; reporter_id: string; subject_type: string; subject_id: string;
  reason: string | null; created_at: string;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db: Db = createServiceClient();
  const { data, error } = await db
    .from("social_reports")
    .select("id, reporter_id, subject_type, subject_id, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "social_reports isn't available yet" }, { status: 503 });
  const rows = (data ?? []) as ReportRow[];

  const postIds = rows.filter((r) => r.subject_type === "post").map((r) => r.subject_id);
  const commentIds = rows.filter((r) => r.subject_type === "comment").map((r) => r.subject_id);
  const profileIds = Array.from(new Set([
    ...rows.filter((r) => r.subject_type === "profile").map((r) => r.subject_id),
    ...rows.map((r) => r.reporter_id),
  ]));

  const [{ data: posts }, { data: comments }, { data: profiles }] = await Promise.all([
    postIds.length
      ? db.from("fantasy_feed_events").select("id, payload").in("id", postIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : Promise.resolve({ data: [] as any[] }),
    commentIds.length
      ? db.from("comments").select("id, body, deleted_at").in("id", commentIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : Promise.resolve({ data: [] as any[] }),
    profileIds.length
      ? db.from("profiles").select("id, display_name, username").in("id", profileIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : Promise.resolve({ data: [] as any[] }),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postById = new Map<string, any>((posts ?? []).map((p: any) => [p.id, p]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commentById = new Map<string, any>((comments ?? []).map((c: any) => [c.id, c]));
  const profById = new Map<string, { display_name: string | null; username: string | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profiles ?? []).map((p: any) => [p.id, p]),
  );
  const nameOf = (id: string) => {
    const p = profById.get(id);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "A manager");
  };

  const reports = rows.map((r) => {
    let preview = "";
    let alreadyHidden = false;
    if (r.subject_type === "post") {
      const p = postById.get(r.subject_id);
      const text = typeof p?.payload?.text === "string" ? p.payload.text : "";
      preview = p ? (text ? text.slice(0, 200) : "(no text, media or poll post)") : "(post not found)";
      alreadyHidden = !!p?.payload?.deleted;
    } else if (r.subject_type === "comment") {
      const c = commentById.get(r.subject_id);
      preview = c ? (c.deleted_at ? "(already deleted)" : String(c.body ?? "").slice(0, 200)) : "(comment not found)";
      alreadyHidden = !!c?.deleted_at;
    } else {
      preview = nameOf(r.subject_id);
    }
    return {
      id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, reason: r.reason,
      createdAt: r.created_at, reporterName: nameOf(r.reporter_id), preview, alreadyHidden,
    };
  });

  return NextResponse.json({ reports });
}

interface Body { action?: "dismiss" | "hide"; id?: string }

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db: Db = createServiceClient();
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || (body.action !== "dismiss" && body.action !== "hide")) {
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
  }

  const { data: report } = await db
    .from("social_reports")
    .select("id, subject_type, subject_id")
    .eq("id", id)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  if (body.action === "hide") {
    if (report.subject_type === "post") {
      const { data: row } = await db.from("fantasy_feed_events").select("payload").eq("id", report.subject_id).maybeSingle();
      const nextPayload = { ...(row?.payload ?? {}), deleted: true };
      const { error } = await db.from("fantasy_feed_events").update({ payload: nextPayload }).eq("id", report.subject_id);
      if (error) return NextResponse.json({ error: "Could not hide post" }, { status: 500 });
    } else if (report.subject_type === "comment") {
      const { error } = await db.from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", report.subject_id);
      if (error) return NextResponse.json({ error: "Could not hide comment" }, { status: 500 });
    } else {
      return NextResponse.json({ error: "Can't hide a profile report, dismiss it instead" }, { status: 400 });
    }
  }

  const { error: delError } = await db.from("social_reports").delete().eq("id", id);
  if (delError) return NextResponse.json({ error: "Could not clear report" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

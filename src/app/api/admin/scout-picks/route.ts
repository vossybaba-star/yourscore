import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";
import { generateScoutPicks, type ScoutCategory } from "@/lib/fantasy/scoutPicks";

// Vercel data cache pins service-role GETs (constant cache key) — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

/**
 * Admin control surface for Scout's Four Picks (Stage 4).
 *
 * GET  ?gw=<n>            — every row for that gameweek (draft/approved/published/
 *                            rejected/superseded), for the approve list to render.
 * POST {action:"generate", gw?} — mechanically re-ranks and re-drafts. Replaces
 *                            DRAFT rows ONLY (generateScoutPicks never touches an
 *                            approved/published/rejected row).
 * POST {action:"approve", id}   — draft -> approved.
 * POST {action:"reject",  id, reason?} — draft or approved -> rejected.
 * POST {action:"publish", id}   — approved -> published, ONLY. Also marks any
 *                            previously published row for the SAME (gw, category)
 *                            as superseded, so the live unique index never
 *                            collides and a user is never shown two live picks
 *                            for one category.
 *
 * fantasy_scout_picks isn't in the generated Database types yet (a brand-new
 * table), so every query here goes through the `Db = SupabaseClient<any,...>`
 * alias scoutPicks.ts already uses — the same idiom src/app/api/admin/approve-
 * question/route.ts uses for the same reason (an untyped table on a typed client).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

type PickStatus = "draft" | "approved" | "published" | "rejected" | "superseded";

interface PickRow {
  id: string; gw: number; category: ScoutCategory; status: PickStatus;
  player_id: number; facts: { player?: string; club?: string } | null;
  reasons: string[]; risk: string | null; signal: string; copy_source: string;
  data_cutoff: string; generated_at: string; approved_at: string | null;
  published_at: string | null; expires_at: string; rejected_reason: string | null;
  backups: unknown[];
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db: Db = createServiceClient();
  const gwParam = req.nextUrl.searchParams.get("gw");
  let q = db.from("fantasy_scout_picks").select("*").order("category");
  if (gwParam) q = q.eq("gw", Number(gwParam));
  else q = q.order("gw", { ascending: false }).limit(20);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ picks: (data ?? []) as PickRow[] });
}

interface Body {
  action?: "generate" | "approve" | "reject" | "publish";
  id?: string;
  gw?: number;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  // requireAdmin() already guarantees `user` exists and is an admin — re-reading
  // here just gets the id for approved_by, never re-checks the gate.

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db: Db = createServiceClient();

  if (body.action === "generate") {
    const result = await generateScoutPicks(db, body.gw);
    if (!result.ok) {
      const status = result.reason === "fixtures-unknown" ? 409 : 422;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({
      ok: true, gw: result.gw, dataCutoff: result.dataCutoff,
      generated: result.rows.map((r) => r.category), skipped: result.skipped,
    });
  }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (body.action === "approve") {
    const { data: row } = await db.from("fantasy_scout_picks").select("status").eq("id", body.id).maybeSingle();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.status !== "draft") {
      return NextResponse.json({ error: `cannot approve a ${row.status} pick — only draft` }, { status: 409 });
    }
    const { error } = await db.from("fantasy_scout_picks")
      .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
      .eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reject") {
    const { data: row } = await db.from("fantasy_scout_picks").select("status").eq("id", body.id).maybeSingle();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.status !== "draft" && row.status !== "approved") {
      return NextResponse.json({ error: `cannot reject a ${row.status} pick` }, { status: 409 });
    }
    const { error } = await db.from("fantasy_scout_picks")
      .update({ status: "rejected", rejected_reason: body.reason ?? null })
      .eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "publish") {
    // Approve-before-publish (acceptance criterion 1): refuse anything not
    // already 'approved' — a draft can never reach a user by skipping review.
    const { data: row } = await db.from("fantasy_scout_picks").select("status, gw, category").eq("id", body.id).maybeSingle();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.status !== "approved") {
      return NextResponse.json({ error: "only an approved pick can be published" }, { status: 409 });
    }
    // Supersede any currently-live pick for the SAME (gw, category) FIRST — the
    // partial unique index on (gw, category) where status='published' would
    // otherwise collide with the row we're about to publish.
    await db.from("fantasy_scout_picks")
      .update({ status: "superseded" })
      .eq("gw", row.gw).eq("category", row.category).eq("status", "published");
    const { error } = await db.from("fantasy_scout_picks")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

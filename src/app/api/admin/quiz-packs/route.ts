import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";

/**
 * The founder's weekly review queue, behind /admin/quiz.
 *
 * GET   — every draft pack (what the factory produced, awaiting approval) plus recently
 *         released ones, so the founder can see what actually went out.
 * PATCH — approve / unapprove / reschedule / reject a pack, or edit one question.
 *
 * Approving is the ONLY thing that lets a pack out: scripts/release-packs.mjs will not
 * publish a pack with approved_at IS NULL, no matter what its release_at says.
 */

// Service-role reads in a route handler get pinned by Vercel's durable Data Cache
// (constant cache key), so an approved pack would keep showing as unapproved forever.
export const fetchCache = "force-no-store";

/**
 * quiz_packs.release_at / approved_at / approved_by / theme are added by migration 80 and
 * are not in the generated Database types until that migration is applied and the types are
 * regenerated. Same untyped-handle pattern src/lib/notify.ts uses for notification_log.
 * Once 80 is applied and `src/types/database.ts` is regenerated, drop this and use `db`.
 */
const untyped = (db: ReturnType<typeof createServiceClient>) => db as unknown as SupabaseClient;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db = untyped(createServiceClient());

  const { data: drafts, error } = await db
    .from("quiz_packs")
    .select("id, name, theme, parameter, questions, status, release_at, approved_at, metadata, created_at")
    .eq("status", "draft")
    .order("release_at", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recently released — context for "what did I already ship?"
  const { data: recent } = await db
    .from("quiz_packs")
    .select("id, name, theme, status, release_at, approved_at, play_count")
    .eq("status", "published")
    .not("approved_at", "is", null)
    .order("release_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ drafts: drafts ?? [], recent: recent ?? [] });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  // Who approved it. requireAdmin already proved they're an admin; we just need the id.
  const authed = await createClient();
  const { data: { user } } = await authed.auth.getUser();

  const { packId, action, releaseAt, questionIndex, question } = await req.json().catch(() => ({}));
  if (!packId || !action) {
    return NextResponse.json({ error: "packId and action are required" }, { status: 400 });
  }

  const db = untyped(createServiceClient());

  const { data: pack } = await db
    .from("quiz_packs")
    .select("id, status, questions")
    .eq("id", packId)
    .maybeSingle();

  if (!pack) return NextResponse.json({ error: "pack not found" }, { status: 404 });

  // A published pack is out in the world — people have played it and hold attempts against
  // it. Editing or re-approving one from this screen would silently change a quiz under
  // players who already sat it, so the review queue only ever touches drafts.
  if (pack.status !== "draft") {
    return NextResponse.json({ error: "pack is already live — edit it from the DB, not the review queue" }, { status: 409 });
  }

  switch (action) {
    case "approve": {
      if (!releaseAt) return NextResponse.json({ error: "releaseAt is required to approve" }, { status: 400 });
      const { error } = await db
        .from("quiz_packs")
        .update({
          approved_at: new Date().toISOString(),
          approved_by: user?.id ?? null,
          release_at: new Date(releaseAt).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", packId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, approved: true });
    }

    case "unapprove": {
      const { error } = await db
        .from("quiz_packs")
        .update({ approved_at: null, approved_by: null, updated_at: new Date().toISOString() })
        .eq("id", packId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, approved: false });
    }

    case "reschedule": {
      if (!releaseAt) return NextResponse.json({ error: "releaseAt is required" }, { status: 400 });
      const { error } = await db
        .from("quiz_packs")
        .update({ release_at: new Date(releaseAt).toISOString(), updated_at: new Date().toISOString() })
        .eq("id", packId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "reject": {
      // Archive rather than delete — a rejected pack is evidence about what the factory
      // gets wrong, and we want to be able to look back at it.
      const { error } = await db
        .from("quiz_packs")
        .update({ status: "archived", approved_at: null, updated_at: new Date().toISOString() })
        .eq("id", packId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, archived: true });
    }

    case "edit-question": {
      const qs = Array.isArray(pack.questions) ? [...pack.questions] : [];
      if (typeof questionIndex !== "number" || questionIndex < 0 || questionIndex >= qs.length) {
        return NextResponse.json({ error: "questionIndex out of range" }, { status: 400 });
      }
      if (!question?.question || !question?.options || !["A", "B", "C", "D"].includes(question?.answer)) {
        return NextResponse.json({ error: "question needs text, options A-D and an answer letter" }, { status: 400 });
      }
      qs[questionIndex] = { ...qs[questionIndex], ...question };
      const { error } = await db
        .from("quiz_packs")
        // question_count is a GENERATED column — never write it.
        .update({ questions: qs, updated_at: new Date().toISOString() })
        .eq("id", packId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// WC Thanks — one-time feedback ask + App Store review ask for the 198-user
// World Cup Mastermind cohort (seeded in migration 100). Two independent
// steps, each stamped once so neither ever re-arms: feedback_done_at then
// review_done_at. GET never errors to the client — a broken prompt isn't
// worth surfacing, it just fails soft to "nothing to show".
//
// wc_thanks_prompts / product_feedback aren't in the generated Database
// type (introduced by this migration, generated types lag it) — cast away
// the strict generic the same way /api/clubs/me does for club_supporters.
function service(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

export async function GET() {
  try {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ stage: null });

    const db = service();
    const { data: row } = await db
      .from("wc_thanks_prompts")
      .select("feedback_done_at, review_done_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!row) return NextResponse.json({ stage: null });
    if (!row.feedback_done_at) return NextResponse.json({ stage: "feedback" });
    if (!row.review_done_at) return NextResponse.json({ stage: "review" });
    return NextResponse.json({ stage: null });
  } catch {
    return NextResponse.json({ stage: null });
  }
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 403 });

  const db = service();
  const { data: row } = await db
    .from("wc_thanks_prompts")
    .select("feedback_done_at, review_done_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: false }, { status: 403 });

  let body: { action?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (body.action === "feedback") {
    if (typeof body.body === "string" && body.body.trim().length > 0 && body.body.length <= 2000) {
      await db.from("product_feedback").insert({ user_id: user.id, body: body.body, source: "wc-thanks" });
    }
    if (!row.feedback_done_at) {
      await db.from("wc_thanks_prompts").update({ feedback_done_at: new Date().toISOString() }).eq("user_id", user.id);
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "review") {
    if (!row.review_done_at) {
      await db.from("wc_thanks_prompts").update({ review_done_at: new Date().toISOString() }).eq("user_id", user.id);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false }, { status: 400 });
}

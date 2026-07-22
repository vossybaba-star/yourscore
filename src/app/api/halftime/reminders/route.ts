import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET/POST /api/halftime/reminders — the signed-in user's "Notify me" requests
 * for specific fixtures' halftime quizzes.
 *
 *   GET               -> { fixtureIds: number[] }  (only UPCOMING ones matter,
 *                        but we return all the user's live rows; past fixtures
 *                        are harmless and get cleaned by the fixture's release.)
 *   POST {fixtureId, on} -> toggles one reminder, returns { on }
 *
 * Auth required: a reminder is a promise to push a specific person, so there is
 * no guest path — we'd have nobody to notify. Writes go through the service role
 * but only after re-checking the caller owns the row (the clubs/me pattern),
 * belt-and-braces over the insert/delete-own RLS policies.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  // Signed out → nothing to show, and no consent to report.
  if (!userId) return NextResponse.json({ fixtureIds: [], signedIn: false, optedIn: false });

  const db = createServiceClient() as unknown as SupabaseClient;
  const [{ data, error }, { data: profile }] = await Promise.all([
    db.from("halftime_reminders").select("fixture_id").eq("user_id", userId),
    db.from("profiles").select("notifications_opt_in").eq("id", userId).maybeSingle(),
  ]);

  if (error) {
    console.error("[halftime/reminders] read failed", error);
    return NextResponse.json({ error: "failed to read reminders" }, { status: 500 });
  }

  return NextResponse.json({
    fixtureIds: ((data ?? []) as { fixture_id: number }[]).map((r) => Number(r.fixture_id)),
    signedIn: true,
    // Release honours consent (requireOptIn), so the button must not promise a
    // push we won't send — the UI shows "turn notifications on" instead.
    optedIn: Boolean((profile as { notifications_opt_in?: boolean } | null)?.notifications_opt_in),
  });
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to get notified" }, { status: 401 });

  let body: { fixtureId?: unknown; on?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request body" }, { status: 400 });
  }

  const fixtureId = Number(body.fixtureId);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ error: "fixtureId must be a positive number" }, { status: 400 });
  }
  const on = body.on === true;

  const db = createServiceClient() as unknown as SupabaseClient;

  // Only allow reminders for a fixture we actually know about, and only before
  // it has released — "notify me" about a quiz that already dropped is a no-op
  // that would sit in the table forever.
  const { data: fixture } = await db
    .from("halftime_releases")
    .select("fixture_id, state")
    .eq("fixture_id", fixtureId)
    .maybeSingle();

  if (!fixture) return NextResponse.json({ error: "no such fixture" }, { status: 404 });

  if (on) {
    const state = (fixture as { state?: string }).state;
    if (state === "released" || state === "released_late") {
      return NextResponse.json({ error: "that quiz has already dropped" }, { status: 409 });
    }
    // Idempotent: tapping twice must not 23505 the user.
    const { error } = await db
      .from("halftime_reminders")
      .upsert({ user_id: userId, fixture_id: fixtureId }, { onConflict: "user_id,fixture_id" });
    if (error) {
      console.error("[halftime/reminders] insert failed", error);
      return NextResponse.json({ error: "failed to save reminder" }, { status: 500 });
    }
  } else {
    const { error } = await db
      .from("halftime_reminders")
      .delete()
      .eq("user_id", userId)
      .eq("fixture_id", fixtureId);
    if (error) {
      console.error("[halftime/reminders] delete failed", error);
      return NextResponse.json({ error: "failed to remove reminder" }, { status: 500 });
    }
  }

  return NextResponse.json({ on });
}

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { londonDayRange, londonMatchday } from "@/lib/halftime/shared";

/**
 * GET /api/gameday/schedule?date=YYYY-MM-DD — the pipeline's read of a matchday.
 *
 * Full detail (questions, fresh slice, veto state) — the poller and the
 * generation scripts read this. Service-role only; never expose it publicly.
 * The public projection is /api/gameday/today.
 *
 * `date` defaults to today (Europe/London). Returns the matchday's kill-switch
 * state alongside the fixtures so the poller can honour it without a second call.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const COLS =
  "id, fixture_id, season_id, round_name, pack_id, home, away, kickoff_at, state, " +
  "base_questions, pack_questions, released_at, created_at, updated_at";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = new URL(req.url).searchParams.get("date");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const matchday = dateParam || londonMatchday();
  const { startUtc, endUtc } = londonDayRange(matchday);

  const db = createServiceClient() as unknown as SupabaseClient;

  const { data: fixtures, error } = await db
    .from("halftime_releases")
    .select(COLS)
    .gte("kickoff_at", startUtc)
    .lt("kickoff_at", endUtc)
    .order("kickoff_at", { ascending: true });

  if (error) {
    console.error("[halftime/schedule] query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  return NextResponse.json({
    matchday,
    fixtures: fixtures ?? [],
  });
}

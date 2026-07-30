import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { PlBriefing } from "@/lib/pl/briefing";

/**
 * GET /api/pl/briefing — PUBLIC. Today's Daily Briefing, or the most recent one.
 *
 * Falls back to the latest row rather than 404ing when today's hasn't been built
 * yet (the cron runs each morning; a reader at 06:00 should still get yesterday's
 * rather than an empty tile). The tile renders the briefing's own date, so a
 * day-old briefing is never passed off as today's.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;
  try {
    const { data } = await db
      .from("pl_briefings").select("doc")
      .order("date", { ascending: false }).limit(1).maybeSingle();
    const doc = (data as { doc?: PlBriefing } | null)?.doc ?? null;
    return NextResponse.json({ doc }, { headers: cache() });
  } catch (err) {
    console.error("[pl/briefing] read failed", err);
    return NextResponse.json({ doc: null }, { headers: cache() });
  }
}

/** A briefing changes once a day, so it can sit on the edge far longer than the
 *  news feed does. */
function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

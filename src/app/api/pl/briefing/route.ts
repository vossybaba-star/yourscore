import { NextResponse } from "next/server";
import { latestBriefing } from "@/lib/pl/briefingRead";

/**
 * GET /api/pl/briefing — PUBLIC. Today's Daily Briefing, or the most recent one.
 *
 * This exists for the TILE, which is a client component inside the news feed.
 * The briefing PAGE does not use it — it reads the row directly (see
 * matchweek/briefing/page.tsx). Two surfaces reading one row through two caches
 * is what let the tile advertise a headline the page hadn't got yet.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const doc = await latestBriefing();
  return NextResponse.json({ doc }, { headers: cache() });
}

/**
 * Short, because the tile is the surface a reader sees FIRST.
 *
 * This was s-maxage=600 with an hour of stale-while-revalidate, which is fine
 * for something that changes once a day and awful for something that changes at
 * a known instant: at 18:00 the CDN was entitled to serve the old briefing for
 * another ten minutes, and the stale window let it keep going for an hour. A
 * minute of drift is invisible; ten is a reader tapping a headline that isn't
 * there. The read is a single indexed row, so the cache is protecting almost
 * nothing anyway.
 */
function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };
}

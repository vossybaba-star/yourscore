import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { PlNewsFeed } from "@/lib/pl/news";

/**
 * GET /api/pl/news — PUBLIC. The general football news feed for Matchweek →
 * PL → News.
 *
 * Reads the singleton `pl_news_feed` doc (id=1) written by the RSS ingest
 * (scripts/pl-news-ingest.mjs). One row, refreshed every ~20 min by cron, so
 * this is a single-row read and edge-cached — SportMonks/DB load is negligible.
 *
 * Soft-fails to an empty feed: the tab shows "nothing yet" rather than erroring
 * if the ingest hasn't run.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;

  try {
    const { data } = await db
      .from("pl_news_feed")
      .select("doc")
      .eq("id", 1)
      .maybeSingle();

    const doc = ((data as { doc?: PlNewsFeed } | null)?.doc ?? { items: [], updatedAt: null }) as PlNewsFeed;
    return NextResponse.json({ doc }, { headers: cache() });
  } catch (err) {
    console.error("[pl/news] feed read failed", err);
    return NextResponse.json({ doc: { items: [], updatedAt: null }, error: "unavailable" }, { status: 200, headers: cache() });
  }
}

function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };
}

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { NewsDoc } from "@/lib/fantasy/news-types";

/**
 * GET /api/pl/news — PUBLIC. The feed doc for the Matchweek → PL → News tab.
 *
 * Reads the latest `fantasy_news_feed.doc` — the SAME cron-built document the
 * fantasy news hub renders. There is ONE feed doc per gameweek, general (same
 * for everyone), so this is a single row read, no per-user work.
 *
 * The doc is written by the fantasy news-hub cron (/api/cron/fantasy-news),
 * which lands with the fantasy merge. Until then the table can be empty or
 * hold an authored doc; either way this returns `{ doc: null }` gracefully and
 * the tab renders its "nothing yet" state rather than an error.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;

  try {
    const { data } = await db
      .from("fantasy_news_feed")
      .select("doc")
      .order("gw", { ascending: false })
      .limit(1)
      .maybeSingle();

    const doc = ((data as { doc?: NewsDoc } | null)?.doc ?? null) as NewsDoc | null;
    return NextResponse.json({ doc }, { headers: cache() });
  } catch (err) {
    console.error("[pl/news] feed read failed", err);
    // Soft-fail: the tab shows "nothing yet", retries on the next visit.
    return NextResponse.json({ doc: null, error: "unavailable" }, { status: 200, headers: cache() });
  }
}

function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" };
}

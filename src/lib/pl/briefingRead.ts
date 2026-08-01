import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { PlBriefing } from "./briefing";

/**
 * Read the current briefing. ONE query, so the page and the API can never
 * disagree about what "current" means.
 *
 * They did disagree, and it was visible to readers. The page used to fetch our
 * own /api/pl/briefing over HTTP, which put Next's Data Cache (600s) in front of
 * a CDN cache (600s, plus an hour of stale-while-revalidate) over the same row.
 * Two independent caches on one piece of data drift apart, so at 18:00 the tile
 * advertised the new headline while the page still rendered yesterday's — tap
 * the tile, get the wrong briefing. Founder report, 1 Aug.
 *
 * Falls back to the most recent row rather than returning nothing when today's
 * hasn't been built yet: a reader at 09:00 should get yesterday's briefing, and
 * the tile renders the briefing's OWN date so a day-old one is never passed off
 * as today's.
 */
export async function latestBriefing(db?: SupabaseClient): Promise<PlBriefing | null> {
  const client = db ?? (createServiceClient() as unknown as SupabaseClient);
  try {
    const { data } = await client
      .from("pl_briefings").select("doc")
      .order("date", { ascending: false }).limit(1).maybeSingle();
    return (data as { doc?: PlBriefing } | null)?.doc ?? null;
  } catch (err) {
    console.error("[pl/briefing] read failed", err);
    return null;
  }
}

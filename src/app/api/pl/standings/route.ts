import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getStandings } from "@/lib/halftime/sportmonks";

/**
 * GET /api/pl/standings — PUBLIC. The Premier League table for the Matchweek →
 * PL → Table tab.
 *
 * The season is derived from halftime_releases (the latest season the halftime
 * pipeline has synced fixtures for), so this self-maintains across seasons with
 * no hardcoded id. One SportMonks standings call, edge-cached for 5 minutes:
 * the table only moves when matches finish, so whistle-freshness is unnecessary
 * here (unlike the pack rail) and the cache keeps SportMonks usage negligible.
 *
 * Pre-season the call returns zero rows (nothing has been played) — the tab
 * renders that as "the table starts on opening day", not an error.
 */

export const revalidate = 300;

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;

  // Latest season the pipeline knows about → the season whose table to show.
  const { data: seasonRow } = await db
    .from("halftime_releases")
    .select("season_id")
    .not("season_id", "is", null)
    .order("season_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const seasonId = Number((seasonRow as { season_id?: number } | null)?.season_id ?? 0);
  if (!seasonId) {
    return NextResponse.json({ seasonId: null, standings: [] }, { headers: cache() });
  }

  try {
    const standings = await getStandings(seasonId);
    return NextResponse.json({ seasonId, standings }, { headers: cache() });
  } catch (err) {
    console.error("[pl/standings] SportMonks failed", err);
    // Soft-fail: the tab shows a "table unavailable" state, tries again in 5 min.
    return NextResponse.json({ seasonId, standings: [], error: "unavailable" }, { status: 200, headers: cache() });
  }
}

function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };
}

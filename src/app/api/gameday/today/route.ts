import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";
import { packName } from "@/lib/gameday/shared";

/**
 * GET /api/gameday/today — PUBLIC. The /play rail and the Home card read
 * this, and it also feeds the standalone halftime prediction poll on the
 * matchweek page (second_half_started_at).
 *
 * Cached at the CDN for 15s on the success path only (see shortCache below).
 * It was fully uncached for the reasons that still apply — a published pack
 * should appear as soon as the daily cron flips it, and second_half_started_at
 * drives when the standalone poll opens — but at ~190ms it was the slowest step
 * in a /play tab switch, so the window is 15s rather than nothing. The failure
 * paths stay no-store.
 *
 * Playable now means state='published' (AC29/AC10) — 'approved'/'base_ready'
 * rows are pre-publish and must stay invisible here, same rule as before the
 * pivot, just against the new state machine. kind='fixture' excludes any
 * future Recap-pack row (§6, not built yet) from this per-fixture surface.
 *
 * "Today" here means "currently live for the rail": a published pack stays
 * playable well past its own kickoff (§3.4 — nothing happens at KO), so the
 * window is kickoff_at >= now-3h rather than a strict calendar day, mirroring
 * the grace period /api/pl/fixtures already uses.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GRACE_MS = 3 * 60 * 60 * 1000;

interface Row {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  state: string;
  pack_id: string | null;
  published_at: string | null;
  round_name: string | null;
  second_half_started_at: string | null;
}

export async function GET() {
  try {
    const db = createServiceClient() as unknown as SupabaseClient;
    const now = Date.now();

    const { data, error } = await db
      .from("halftime_releases")
      .select(
        "fixture_id, home, away, kickoff_at, state, pack_id, published_at, round_name, second_half_started_at",
      )
      .eq("kind", "fixture")
      .eq("state", "published")
      .gte("kickoff_at", new Date(now - GRACE_MS).toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(50);

    if (error) {
      console.error("[gameday/today] query failed", error);
      return NextResponse.json({ fixtures: [] }, { headers: noStore() });
    }

    const fixtures = ((data ?? []) as Row[]).map((r) => ({
      fixture_id: r.fixture_id,
      home: r.home,
      away: r.away,
      kickoff_at: r.kickoff_at,
      round_name: r.round_name,
      state: r.state,
      published_at: r.published_at,
      pack_id: r.pack_id,
      slug: r.pack_id ? slugify(packName(r)) : null,
      second_half_started_at: r.second_half_started_at,
    }));

    return NextResponse.json({ fixtures }, { headers: shortCache() });
  } catch (err) {
    console.error("[gameday/today] failed", err);
    return NextResponse.json({ fixtures: [] }, { headers: noStore() });
  }
}

/**
 * Short CDN cache for the SUCCESS path only (founder call, 2026-08-01).
 *
 * This route was fully uncached, and at ~190ms warm it was the slowest step in a
 * /play tab switch — the rail waits on it after hydration. The freshness rules it
 * was protecting still hold, so the window is deliberately small rather than the
 * 60s used elsewhere: a published pack appears at most ~15s after the cron flips
 * it, and the halftime poll opens at most ~15s late (up to ~30s in the
 * stale-while-revalidate tail, during which the refresh is already in flight).
 *
 * s-maxage is CDN-only; there is no max-age, so a browser never holds its own
 * stale copy — a hard refresh always reaches the edge.
 *
 * To revert, swap this back to noStore() and the old behaviour returns exactly.
 * If a live matchday ever needs true real-time here, gate it: serve noStore()
 * when any fixture is in its second half and shortCache() otherwise.
 */
function shortCache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15" };
}

/**
 * No CDN cache, no browser cache. Kept for the FAILURE paths: an empty-fixtures
 * fallback must never be cached, or a transient Supabase blip would pin "no games
 * today" across the CDN for the whole window and hide the real rail.
 */
function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

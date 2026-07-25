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
 * Deliberately UNCACHED — a published pack must appear the moment the daily
 * cron flips it, and second_half_started_at must be fresh for the standalone
 * poll to open on time.
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

    return NextResponse.json({ fixtures }, { headers: noStore() });
  } catch (err) {
    console.error("[gameday/today] failed", err);
    return NextResponse.json({ fixtures: [] }, { headers: noStore() });
  }
}

/** No CDN cache, no browser cache. */
function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

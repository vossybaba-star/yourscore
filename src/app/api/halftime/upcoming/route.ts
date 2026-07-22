import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/halftime/upcoming — PUBLIC. The forward schedule for Matchweek →
 * Live Quiz: the gameweeks coming up and the quizzes (one per fixture) that
 * will drop at each half-time.
 *
 * Unlike /api/halftime/schedule (CRON_SECRET, single day, full pack detail),
 * this is a lean public projection — fixtures grouped by gameweek, no question
 * content — so the schedule renders before a ball is kicked. It shows the whole
 * synced future (kickoff >= now), grouped and ordered by gameweek.
 */

export const revalidate = 300;

interface Row {
  fixture_id: number;
  round_name: string | null;
  home: string;
  away: string;
  kickoff_at: string;
  state: string;
  season_id: number | null;
}

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;

  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("halftime_releases")
    .select("fixture_id, round_name, home, away, kickoff_at, state, season_id")
    .gte("kickoff_at", nowIso)
    .order("kickoff_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[halftime/upcoming] query failed", error);
    return NextResponse.json({ gameweeks: [] }, { status: 200, headers: cache() });
  }

  // Group by gameweek, preserving kickoff order. A Map keeps first-seen order,
  // which is chronological because the query is already sorted by kickoff.
  const byGw = new Map<string, { round: string; kickoffFirst: string; fixtures: Array<{ fixtureId: number; home: string; away: string; kickoff: string; state: string }> }>();
  for (const r of (data ?? []) as Row[]) {
    const round = r.round_name ?? "TBC";
    if (!byGw.has(round)) byGw.set(round, { round, kickoffFirst: r.kickoff_at, fixtures: [] });
    // fixtureId is the key "Notify me" stores against — without it the client
    // has no stable handle on a fixture.
    byGw.get(round)!.fixtures.push({
      fixtureId: Number(r.fixture_id), home: r.home, away: r.away, kickoff: r.kickoff_at, state: r.state,
    });
  }

  const gameweeks = Array.from(byGw.values());
  return NextResponse.json({ gameweeks }, { headers: cache() });
}

function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };
}

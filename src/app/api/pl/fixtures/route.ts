import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";
import { isReleased, packName, type HalftimeState } from "@/lib/halftime/shared";

/**
 * GET /api/pl/fixtures — PUBLIC. This gameweek's Premier League fixtures for the
 * Matchweek → PL → Fixtures tab.
 *
 * It reads halftime_releases (already synced weekly by the halftime pipeline), so
 * there is no extra SportMonks call AND every fixture carries its halftime quiz
 * for free — the fixtures list and the live quizzes are the same data. Each
 * fixture reports whether its quiz is live yet (pack_id/slug withheld until the
 * whistle, exactly as /api/halftime/today does — a pack must be invisible before
 * it releases).
 *
 * "This gameweek" = the round of the next upcoming fixture; if every fixture in
 * the window is already played, the most recent round (so the tab shows last
 * week's results rather than going blank between gameweeks).
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// A generous window either side of now catches the current gameweek plus the
// next, even across an international break — without scanning the whole season.
const LOOKBACK_MS = 4 * 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 12 * 24 * 60 * 60 * 1000;
const HIDDEN_STATES: HalftimeState[] = ["cancelled", "failed"];

interface Row {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  state: HalftimeState;
  pack_id: string | null;
  round_name: string | null;
}

export async function GET() {
  try {
    const db = createServiceClient() as unknown as SupabaseClient;
    const now = Date.now();

    const { data, error } = await db
      .from("halftime_releases")
      .select("fixture_id, home, away, kickoff_at, state, pack_id, round_name")
      .gte("kickoff_at", new Date(now - LOOKBACK_MS).toISOString())
      .lt("kickoff_at", new Date(now + LOOKAHEAD_MS).toISOString())
      .order("kickoff_at", { ascending: true });

    if (error) {
      console.error("[pl/fixtures] query failed", error);
      return NextResponse.json({ round: null, fixtures: [] }, { headers: noStore() });
    }

    const rows = ((data ?? []) as Row[]).filter((r) => !HIDDEN_STATES.includes(r.state));
    if (!rows.length) return NextResponse.json({ round: null, fixtures: [] }, { headers: noStore() });

    // The current gameweek: the round of the next fixture still to kick off
    // (a 3h grace so a match in progress still counts as "now"); else the last.
    const upcoming = rows.find((r) => new Date(r.kickoff_at).getTime() >= now - 3 * 60 * 60 * 1000);
    const round = (upcoming ?? rows[rows.length - 1]).round_name;

    const fixtures = rows
      .filter((r) => r.round_name === round)
      .map((r) => {
        const live = isReleased(r.state);
        return {
          fixture_id: r.fixture_id,
          home: r.home,
          away: r.away,
          kickoff_at: r.kickoff_at,
          state: r.state,
          // Quiz linkage: withheld until the whistle (same rule as /halftime/today).
          quiz: live && r.pack_id
            ? { live: true, pack_id: r.pack_id, slug: slugify(packName(r)) }
            : { live: false, pack_id: null, slug: null },
        };
      });

    return NextResponse.json({ round, fixtures }, { headers: noStore() });
  } catch (err) {
    console.error("[pl/fixtures] failed", err);
    return NextResponse.json({ round: null, fixtures: [] }, { headers: noStore() });
  }
}

function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

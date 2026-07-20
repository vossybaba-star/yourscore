import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";
import {
  isReleased,
  londonDayRange,
  londonMatchday,
  packName,
  type HalftimeState,
} from "@/lib/halftime/shared";

/**
 * GET /api/halftime/today — PUBLIC. The /play rail and the Home card read this.
 *
 * Deliberately UNCACHED. Every other pack surface is edge-cached (/api/quiz/packs
 * at s-maxage=120, /api/challenges/pack at s-maxage=3600) and is therefore
 * useless here: the whole feature is "the pack appears at the whistle", and a
 * 2-minute CDN cache would make that a 2-minute lie. This route is small
 * (a handful of rows, no questions) and only fetched by users on /play, so
 * serving it fresh costs little and is the only way the rail can flip on time.
 *
 * PROJECTION ONLY — no questions, no fresh slice, no veto state, no telegram
 * ids. Pack content is anon-unreadable at the DB (RLS deny-all) and must stay
 * unreadable here too: before the whistle the pack must be impossible to see.
 * pack_id and slug are withheld until the fixture is actually released, so a
 * staged pack cannot be opened early even by someone guessing the URL.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Row {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  state: HalftimeState;
  pack_id: string | null;
  released_at: string | null;
  round_name: string | null;
}

// A postponed or failed fixture has no pack and never will — showing it as
// "quiz drops at half time" would be a lie, so it is not surfaced at all.
const HIDDEN_STATES: HalftimeState[] = ["cancelled", "failed"];

export async function GET() {
  try {
    const db = createServiceClient() as unknown as SupabaseClient;
    const matchday = londonMatchday();
    const { startUtc, endUtc } = londonDayRange(matchday);

    const { data, error } = await db
      .from("halftime_releases")
      .select("fixture_id, home, away, kickoff_at, state, pack_id, released_at, round_name")
      .gte("kickoff_at", startUtc)
      .lt("kickoff_at", endUtc)
      .order("kickoff_at", { ascending: true });

    if (error) {
      console.error("[halftime/today] query failed", error);
      return NextResponse.json({ matchday, fixtures: [] }, { headers: noStore() });
    }

    const fixtures = ((data ?? []) as Row[])
      .filter((r) => !HIDDEN_STATES.includes(r.state))
      .map((r) => {
        const live = isReleased(r.state);
        return {
          fixture_id: r.fixture_id,
          home: r.home,
          away: r.away,
          kickoff_at: r.kickoff_at,
          round_name: r.round_name,
          state: r.state,
          released_at: r.released_at,
          // Withheld until release: pre-whistle the quiz_packs row does not
          // exist, so these would only ever resolve to a 404 anyway — but
          // withholding them keeps "invisible before the whistle" true by
          // construction rather than by accident.
          pack_id: live ? r.pack_id : null,
          slug: live ? slugify(packName(r)) : null,
        };
      });

    return NextResponse.json({ matchday, fixtures }, { headers: noStore() });
  } catch (err) {
    console.error("[halftime/today] failed", err);
    return NextResponse.json({ matchday: londonMatchday(), fixtures: [] }, { headers: noStore() });
  }
}

/** No CDN cache, no browser cache — the rail must flip the moment the pack lands. */
function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

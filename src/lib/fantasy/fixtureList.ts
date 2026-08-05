/**
 * The current gameweek's fixture list, for the Social composer's "Fixture"
 * attachment (Phase 2b). Reuses `fetchFixturesWindow` (news.ts) — the SAME
 * SportMonks list call the fixture ticker is built from — rather than a new
 * fetcher; this just stops short of collapsing it into the ticker's per-club
 * shape and keeps the raw home/away pairs + kickoff time instead.
 *
 * A short in-process cache (5 min) so opening the sheet repeatedly doesn't
 * re-hit SportMonks every time — fixtures for a gameweek barely move once
 * the calendar is set.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFixturesWindow } from "./news";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface GwFixture {
  fixtureId: number;
  homeClub: string;
  awayClub: string;
  kickoffIso: string;
  gw: number;
}

const CACHE_MS = 5 * 60 * 1000;
let cache: { gw: number; at: number; fixtures: GwFixture[] } | null = null;

/** The gameweek's raw fixture list — home/away club names + kickoff, sorted
 *  by kickoff. Never throws: pre-season (no fixtures yet), a missing API key,
 *  or a SportMonks hiccup all resolve to an empty list, matching AC8 (the
 *  composer's Fixture sheet must render an empty state, not crash). */
export async function loadCurrentGwFixtures(db: Db): Promise<GwFixture[]> {
  const { data: gws } = await db.from("fantasy_gameweeks")
    .select("gw, window_start, window_end")
    .neq("status", "final").order("gw").limit(1);
  const gwRow = (gws ?? [])[0] as { gw: number; window_start: string; window_end: string } | undefined;
  if (!gwRow) return [];

  if (cache && cache.gw === gwRow.gw && Date.now() - cache.at < CACHE_MS) return cache.fixtures;

  try {
    const raw = await fetchFixturesWindow(gwRow.window_start, gwRow.window_end);
    const fixtures: GwFixture[] = [];
    for (const f of raw) {
      const home = f.participants?.find((p) => p.meta?.location === "home");
      const away = f.participants?.find((p) => p.meta?.location === "away");
      if (!home?.name || !away?.name || !f.starting_at) continue;
      fixtures.push({ fixtureId: f.id, homeClub: home.name, awayClub: away.name, kickoffIso: f.starting_at, gw: gwRow.gw });
    }
    fixtures.sort((a, b) => Date.parse(a.kickoffIso) - Date.parse(b.kickoffIso));
    cache = { gw: gwRow.gw, at: Date.now(), fixtures };
    return fixtures;
  } catch {
    return cache?.gw === gwRow.gw ? cache.fixtures : [];
  }
}

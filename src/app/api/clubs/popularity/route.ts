import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/clubs/popularity — PUBLIC, no auth needed.
 *
 * How many of our own players support each club, most-supported first. Drives
 * which club quiz leads the Versus Quiz Battle picker (founder rule, 2026-07-23:
 * "featured should be in order of club popularity of our users").
 *
 * Counts DISTINCT user_id, not rows: club_supporters' PK is (user_id, season_id),
 * so a fan who has declared in two seasons has two rows and would otherwise be
 * counted twice.
 *
 * Deliberately does NOT touch quiz_packs.featured. That flag is shared with the
 * home hero (src/lib/daily-game.ts) and the solo Quiz hub, and the founder chose
 * to leave both alone (2026-07-23) — this ordering is Versus-only.
 *
 * Service-role read, so `fetchCache = "force-no-store"` is required or Vercel's
 * data cache pins the first response forever (see CLAUDE.md). The CDN still
 * caches the RESPONSE for an hour: supporter counts move slowly and nothing here
 * is per-user.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export interface ClubPopularity {
  club: string;
  fans: number;
}

export async function GET() {
  try {
    const db = createServiceClient() as unknown as SupabaseClient;
    const { data, error } = await db.from("club_supporters").select("user_id, club");
    if (error) throw error;

    // Distinct users per club, tallied in memory — the table is small (hundreds
    // of rows) and this avoids needing a new SQL function for one aggregate.
    const seen = new Map<string, Set<string>>();
    for (const row of (data ?? []) as { user_id: string; club: string }[]) {
      if (!row.club || !row.user_id) continue;
      const set = seen.get(row.club) ?? new Set<string>();
      set.add(row.user_id);
      seen.set(row.club, set);
    }

    const clubs: ClubPopularity[] = Array.from(seen.entries())
      .map(([club, users]) => ({ club, fans: users.size }))
      // Ties broken alphabetically so the order is stable between requests
      // rather than reshuffling on whatever order Postgres returned.
      .sort((a, b) => b.fans - a.fans || a.club.localeCompare(b.club));

    return NextResponse.json({ clubs }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    // Never break the picker over this — an empty list just means the caller
    // falls back to its previous ordering.
    return NextResponse.json({ clubs: [] as ClubPopularity[] });
  }
}

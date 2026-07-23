import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { rankClubs, type ClubPopularity } from "@/lib/clubs/popularity";

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

export async function GET() {
  try {
    const db = createServiceClient() as unknown as SupabaseClient;
    // Tallied in memory rather than via a new SQL aggregate — the table is
    // hundreds of rows, and rankClubs() is the same code the matchmaker uses.
    const { data, error } = await db.from("club_supporters").select("user_id, club");
    if (error) throw error;
    const clubs = rankClubs((data ?? []) as { user_id: string | null; club: string | null }[]);

    return NextResponse.json({ clubs }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    // Never break the picker over this — an empty list just means the caller
    // falls back to its previous ordering.
    return NextResponse.json({ clubs: [] as ClubPopularity[] });
  }
}

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { supporterRow, clubsForSeason, currentSeasonId, suggestClubForUser } from "@/lib/clubs/query";

/**
 * GET/POST /api/clubs/me — the signed-in user's own club declaration.
 *
 * GET returns { club, suggestion, locked, clubs } — `clubs` (the season's valid
 * roster) is an addition beyond the brief's literal `{club, suggestion, locked}`
 * shape: ClubPicker needs the full list to render its "choose a different club"
 * fallback, and the only alternative (deriving it from /api/clubs/table) would be
 * empty early in a season before any gameweek has completed. Still a superset of
 * the specified contract, so nothing that reads `club`/`suggestion`/`locked`
 * breaks.
 *
 * SEASON-SCOPED, deliberately. The declaration is locked for THE SEASON, not for
 * life: club_supporters' PK is (user_id, season_id), so a fan is immovable within
 * a season (no update/delete policy exists) but may declare afresh when a new
 * season starts. Every read here is therefore keyed on the current season — a
 * lookup ignoring season_id would return multiple rows for a returning fan and
 * blow up on .maybeSingle().
 *
 * POST sets it. Service-role write, but only after re-checking the caller owns
 * user_id === auth.uid() (mirrors the h2h/seen route pattern) — belt-and-braces
 * on top of the DB-level "insert own row" RLS policy and the PK-enforced lock.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function service(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

export async function GET() {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const seasonId = await currentSeasonId();
    if (seasonId == null) {
      // No halftime data exists yet — nothing to declare into.
      return NextResponse.json(
        { club: null, suggestion: null, locked: false, clubs: [] },
        { headers: noStore() },
      );
    }

    // Locked for THIS season if a row exists for it. A row from a previous season
    // does not lock them — they get to declare again for the new one.
    const existing = await supporterRow(user.id, seasonId);
    if (existing) {
      return NextResponse.json(
        { club: existing.club, suggestion: null, locked: true, clubs: [] },
        { headers: noStore() },
      );
    }

    const clubs = await clubsForSeason(seasonId);
    const suggestion = await suggestClubForUser(user.id, clubs);
    return NextResponse.json({ club: null, suggestion, locked: false, clubs }, { headers: noStore() });
  } catch (err) {
    console.error("[clubs/me GET] failed", err);
    return NextResponse.json({ error: "Failed to load club" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { club?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const club = body.club?.trim();
  if (!club) return NextResponse.json({ error: "club required" }, { status: 400 });

  try {
    const seasonId = await currentSeasonId();
    if (seasonId == null) {
      return NextResponse.json({ error: "No active season to declare a club for" }, { status: 400 });
    }

    // Locked for THIS season only. The DB is the real guard — PK (user_id,
    // season_id) plus no update/delete policy — so a race here still 23505s below.
    const existing = await supporterRow(user.id, seasonId);
    if (existing) {
      return NextResponse.json(
        { error: "Club already set — it's locked for the season", club: existing.club },
        { status: 409 },
      );
    }

    const validClubs = await clubsForSeason(seasonId);
    if (!validClubs.includes(club)) {
      return NextResponse.json({ error: "Not a valid club this season" }, { status: 400 });
    }

    const { error: insertErr } = await service()
      .from("club_supporters")
      .insert({ user_id: user.id, club, season_id: seasonId });

    if (insertErr) {
      // Unique-violation race: a concurrent request for this user won first.
      if ((insertErr as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Club already set — it's locked for the season" },
          { status: 409 },
        );
      }
      throw insertErr;
    }

    return NextResponse.json({ ok: true, club });
  } catch (err) {
    console.error("[clubs/me POST] failed", err);
    return NextResponse.json({ error: "Failed to set club" }, { status: 500 });
  }
}

function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0, must-revalidate" };
}

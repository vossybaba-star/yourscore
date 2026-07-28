import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { supporterRow, clubsForSeason, currentSeasonId, suggestClubForUser } from "@/lib/clubs/query";

/**
 * GET/POST /api/clubs/me — the signed-in user's own club declaration.
 *
 * GET returns { club, suggestion, clubs, changedAt, canChangeAt, canChangeNow }.
 * `clubs` (the season's valid roster) is always sent now, even once a club is set,
 * because a fan whose cooldown has elapsed can pick a new one and the change UI
 * needs the full list. `locked` is kept for back-compat and means "cannot change
 * right now" (a club is set and still inside the 30-day cooldown).
 *
 * 30-DAY COOLDOWN (founder, 2026-07-27, migration 212). A supporter may change
 * club at most once every 30 days, measured from changed_at. The first pick also
 * starts a 30-day window. This replaced the old season-long lock; the DB is still
 * the real guard (cooldown trigger in migration 212), this route just returns a
 * clean 409 with the next-eligible date instead of letting the trigger raise.
 *
 * SEASON-SCOPED, deliberately: every read is keyed on the current season, so a
 * returning fan's old-season row never collides on .maybeSingle().
 *
 * POST sets or changes it. Service-role write, but only after re-checking the
 * caller owns user_id === auth.uid() (mirrors the h2h/seen route pattern).
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** When this supporter may next change club, given when they last set it. */
function changeableAt(changedAt: string): number {
  return new Date(changedAt).getTime() + COOLDOWN_MS;
}

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
        { club: null, suggestion: null, locked: false, clubs: [], changedAt: null, canChangeAt: null, canChangeNow: false },
        { headers: noStore() },
      );
    }

    const clubs = await clubsForSeason(seasonId);
    const existing = await supporterRow(user.id, seasonId);

    if (existing) {
      const canChangeAt = changeableAt(existing.changedAt);
      const canChangeNow = Date.now() >= canChangeAt;
      return NextResponse.json(
        {
          club: existing.club,
          suggestion: null,
          locked: !canChangeNow,
          clubs,
          changedAt: existing.changedAt,
          canChangeAt: new Date(canChangeAt).toISOString(),
          canChangeNow,
        },
        { headers: noStore() },
      );
    }

    const suggestion = await suggestClubForUser(user.id, clubs);
    return NextResponse.json(
      { club: null, suggestion, locked: false, clubs, changedAt: null, canChangeAt: null, canChangeNow: true },
      { headers: noStore() },
    );
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

    const validClubs = await clubsForSeason(seasonId);
    if (!validClubs.includes(club)) {
      return NextResponse.json({ error: "Not a valid club this season" }, { status: 400 });
    }

    const existing = await supporterRow(user.id, seasonId);

    // Already supporting this exact club — nothing to do (and must not reset the
    // cooldown clock). Idempotent success.
    if (existing && existing.club === club) {
      return NextResponse.json({ ok: true, club });
    }

    // Changing to a different club: gate on the 30-day cooldown. The DB cooldown
    // trigger (migration 212) is the real guard — this just returns a clean date.
    if (existing) {
      const canChangeAt = changeableAt(existing.changedAt);
      if (Date.now() < canChangeAt) {
        return NextResponse.json(
          {
            error: "You can change your club again once the 30 days are up",
            club: existing.club,
            canChangeAt: new Date(canChangeAt).toISOString(),
          },
          { status: 409 },
        );
      }

      const { error: updateErr } = await service()
        .from("club_supporters")
        .update({ club, changed_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("season_id", seasonId);

      if (updateErr) {
        // The cooldown trigger fires on a concurrent race that slipped past the
        // check above — surface it as the same clean 409.
        if ((updateErr as { code?: string }).code === "23514") {
          return NextResponse.json(
            { error: "You can change your club again once the 30 days are up", club: existing.club },
            { status: 409 },
          );
        }
        throw updateErr;
      }

      return NextResponse.json({ ok: true, club });
    }

    // First-ever pick for the season. Starts the first 30-day window.
    const { error: insertErr } = await service()
      .from("club_supporters")
      .insert({ user_id: user.id, club, season_id: seasonId });

    if (insertErr) {
      // Unique-violation race: a concurrent request for this user won first.
      if ((insertErr as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "Club already set — try again", club }, { status: 409 });
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

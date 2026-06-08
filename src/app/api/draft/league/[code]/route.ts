import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDraftDb } from "@/lib/draft/server";

// League board: members ranked by in-league H2H wins, each with an "available"
// flag (their team is active and challengeable). Fails soft pre-migration.

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const code = (params.code ?? "").toUpperCase();

  try {
    const db = createDraftDb();
    const { data: league, error: leagueErr } = await db
      .from("draft_leagues")
      .select("id, name, join_code")
      .eq("join_code", code)
      .maybeSingle();
    // Missing table (migration not applied) → soft "coming soon", not a 404.
    if (leagueErr) return NextResponse.json({ ready: false });
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const { data: members } = await db
      .from("draft_league_members")
      .select("user_id")
      .eq("league_id", league.id);
    const ids = (members ?? []).map((m) => m.user_id);

    // Read W/D/L straight from the per-league standings (live finalize +
    // creditResult keep these correct, incl. draws; async wins land here too).
    const [{ data: standings }, { data: teams }] = await Promise.all([
      db.from("draft_standings").select("user_id, display_name, wins_all_time, draws_all_time, losses_all_time").eq("league_id", league.id),
      ids.length
        ? db.from("draft_teams").select("user_id, display_name, status, strength_rating").in("user_id", ids)
        : Promise.resolve({ data: [] as { user_id: string; display_name: string | null; status: string; strength_rating: number }[] }),
    ]);

    const standMap = new Map((standings ?? []).map((s) => [s.user_id, s]));
    const teamMap = new Map((teams ?? []).map((t) => [t.user_id, t]));

    const rows = ids.map((uid) => {
      const s = standMap.get(uid);
      const t = teamMap.get(uid);
      const won = s?.wins_all_time ?? 0;
      const drawn = s?.draws_all_time ?? 0;
      const lost = s?.losses_all_time ?? 0;
      return {
        user_id: uid,
        display_name: t?.display_name ?? s?.display_name ?? "Player",
        played: won + drawn + lost,
        won,
        drawn,
        lost,
        points: won * 3 + drawn,
        strength: t ? Number(t.strength_rating) : null,
        available: !!t && t.status === "active",
        is_me: !!user && uid === user.id,
      };
    });
    // League-table order: points, then wins, then fewer played (better win rate), then strength.
    rows.sort((a, b) =>
      b.points - a.points ||
      b.won - a.won ||
      a.played - b.played ||
      (b.strength ?? 0) - (a.strength ?? 0)
    );

    return NextResponse.json({
      league: { id: league.id, name: league.name, code: league.join_code },
      members: rows,
      isMember: !!user && ids.includes(user.id),
      ready: true,
    });
  } catch {
    return NextResponse.json({ error: "Leaderboards not live yet", ready: false }, { status: 200 });
  }
}

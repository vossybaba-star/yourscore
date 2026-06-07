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

    const [{ data: standings }, { data: teams }] = await Promise.all([
      db.from("draft_standings").select("user_id, display_name, wins_today, wins_all_time").eq("league_id", league.id),
      ids.length
        ? db.from("draft_teams").select("user_id, display_name, status, strength_rating").in("user_id", ids)
        : Promise.resolve({ data: [] as { user_id: string; display_name: string | null; status: string; strength_rating: number }[] }),
    ]);

    const standMap = new Map((standings ?? []).map((s) => [s.user_id, s]));
    const teamMap = new Map((teams ?? []).map((t) => [t.user_id, t]));

    const rows = ids.map((uid) => {
      const s = standMap.get(uid);
      const t = teamMap.get(uid);
      return {
        user_id: uid,
        display_name: t?.display_name ?? s?.display_name ?? "Player",
        wins_today: s?.wins_today ?? 0,
        wins_all_time: s?.wins_all_time ?? 0,
        strength: t ? Number(t.strength_rating) : null,
        available: !!t && t.status === "active",
        is_me: !!user && uid === user.id,
      };
    });
    rows.sort((a, b) => b.wins_all_time - a.wins_all_time || b.wins_today - a.wins_today);

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

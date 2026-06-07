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

    const [{ data: standings }, { data: teams }, { data: matches }] = await Promise.all([
      db.from("draft_standings").select("user_id, display_name, wins_today, wins_all_time").eq("league_id", league.id),
      ids.length
        ? db.from("draft_teams").select("user_id, display_name, status, strength_rating").in("user_id", ids)
        : Promise.resolve({ data: [] as { user_id: string; display_name: string | null; status: string; strength_rating: number }[] }),
      // Every league match feeds the table (P/W/L). H2H has no draws, so L = P − W.
      db.from("draft_matches").select("challenger_id, opponent_id, winner_id").eq("league_id", league.id),
    ]);

    const standMap = new Map((standings ?? []).map((s) => [s.user_id, s]));
    const teamMap = new Map((teams ?? []).map((t) => [t.user_id, t]));

    // Tally played/won per member from match history (a member can be either side).
    const memberSet = new Set(ids);
    const tally = new Map<string, { played: number; won: number }>();
    const bump = (uid: string | null, won: boolean) => {
      if (!uid || !memberSet.has(uid)) return;
      const t = tally.get(uid) ?? { played: 0, won: 0 };
      t.played += 1; if (won) t.won += 1;
      tally.set(uid, t);
    };
    for (const m of matches ?? []) {
      bump(m.challenger_id, m.winner_id === m.challenger_id);
      bump(m.opponent_id, m.winner_id === m.opponent_id);
    }

    const rows = ids.map((uid) => {
      const s = standMap.get(uid);
      const t = teamMap.get(uid);
      const tl = tally.get(uid) ?? { played: 0, won: 0 };
      const played = tl.played;
      const won = tl.won;
      const lost = played - won;
      return {
        user_id: uid,
        display_name: t?.display_name ?? s?.display_name ?? "Player",
        played,
        won,
        lost,
        points: won * 3,
        wins_today: s?.wins_today ?? 0,
        wins_all_time: s?.wins_all_time ?? 0,
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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDraftDb } from "@/lib/draft/server";
import { leagueLiveStateFor } from "@/lib/draft/live-server";

// League board: members ranked by in-league points (live W/D/L), each with an
// honest "online" flag (presence heartbeat) so you only challenge managers who
// are actually around. Also returns any live challenges sent to you, and a match
// you're mid-way through. Fails soft pre-migration.

const ONLINE_WINDOW_MS = 75_000; // "online" = league board loaded in the last ~75s

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const code = (params.code ?? "").toUpperCase();

  try {
    const db = createDraftDb();
    const { data: league, error: leagueErr } = await db
      .from("draft_leagues")
      .select("id, name, join_code, owner_id")
      .eq("join_code", code)
      .maybeSingle();
    // Missing table (migration not applied) → soft "coming soon", not a 404.
    if (leagueErr) return NextResponse.json({ ready: false });
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    // Presence heartbeat: loading the board marks you online for the next window.
    if (user) {
      await db.from("draft_league_members")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("league_id", league.id).eq("user_id", user.id);
    }

    const { data: members } = await db
      .from("draft_league_members")
      .select("user_id, last_seen_at")
      .eq("league_id", league.id);
    const ids = (members ?? []).map((m) => m.user_id);
    const seenMap = new Map((members ?? []).map((m) => [m.user_id, m.last_seen_at]));
    const now = Date.now();
    const onlineOf = (uid: string): boolean => {
      const seen = seenMap.get(uid);
      return !!seen && now - Date.parse(seen) < ONLINE_WINDOW_MS;
    };

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
      const hasTeam = !!t && t.status === "active";
      return {
        user_id: uid,
        display_name: t?.display_name ?? s?.display_name ?? "Player",
        played: won + drawn + lost,
        won,
        drawn,
        lost,
        points: won * 3 + drawn,
        strength: t ? Number(t.strength_rating) : null,
        hasTeam,
        // Challengeable = online now AND has a live team to play.
        online: onlineOf(uid),
        available: hasTeam && onlineOf(uid),
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

    // Live challenges sent to me + any match I'm mid-way through (so the board can
    // surface "X challenged you" and "Resume your match").
    const live = user && ids.includes(user.id)
      ? await leagueLiveStateFor(db, league.id, user.id)
      : { incoming: [], activeMatchId: null };

    return NextResponse.json({
      league: { id: league.id, name: league.name, code: league.join_code },
      members: rows,
      isMember: !!user && ids.includes(user.id),
      isOwner: !!user && league.owner_id === user.id,
      incoming: live.incoming,
      activeMatchId: live.activeMatchId,
      ready: true,
    });
  } catch {
    return NextResponse.json({ error: "Leaderboards not live yet", ready: false }, { status: 200 });
  }
}

// PATCH: rename a league (owner only).
export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  let body: { name?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const db = createDraftDb();
  const { data: league } = await db.from("draft_leagues").select("id, owner_id").eq("join_code", (params.code ?? "").toUpperCase()).maybeSingle();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.owner_id !== user.id) return NextResponse.json({ error: "Only the league owner can rename it" }, { status: 403 });

  await db.from("draft_leagues").update({ name }).eq("id", league.id);
  return NextResponse.json({ ok: true, name });
}

// DELETE ?mode=leave  → remove yourself from the league (non-owner).
// DELETE ?mode=delete → owner deletes the whole league (members cascade).
export async function DELETE(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const mode = req.nextUrl.searchParams.get("mode") === "delete" ? "delete" : "leave";
  const db = createDraftDb();
  const { data: league } = await db.from("draft_leagues").select("id, owner_id").eq("join_code", (params.code ?? "").toUpperCase()).maybeSingle();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  const isOwner = league.owner_id === user.id;

  if (mode === "delete") {
    if (!isOwner) return NextResponse.json({ error: "Only the owner can delete this league" }, { status: 403 });
    await db.from("draft_league_members").delete().eq("league_id", league.id);
    await db.from("draft_leagues").delete().eq("id", league.id);
    return NextResponse.json({ ok: true, deleted: true });
  }

  // Leave. The owner can't simply leave (would orphan the league) — they delete it.
  if (isOwner) return NextResponse.json({ error: "You own this league — delete it instead of leaving" }, { status: 400 });
  await db.from("draft_league_members").delete().eq("league_id", league.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true, left: true });
}

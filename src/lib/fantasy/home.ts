import "server-only";
/**
 * The Fantasy tab's HOME — a feed-first landing (founder, 2 Aug). Tapping Fantasy
 * lands here, not on the squad. Two layers:
 *   1. "You" — where you stand right now (squad in / build it, deadline, rank).
 *   2. The feed — the social spine: your leagues' chatter, other managers' moves,
 *      and, when you have none of that yet, the get-started + discovery layers so
 *      it is NEVER a blank screen (a cold or pre-season user still sees activity).
 *
 * Everything is assembled here so the client makes one call. Reuses the existing
 * standings, feed and league plumbing rather than growing parallel copies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGlobalStandings } from "./standings";
import { loadFeed, type FeedEvent } from "./feed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface HomeYou {
  hasSquad: boolean;
  gw: number | null;
  phase: "pre" | "live" | "final";
  deadline: string | null;
  /** Season standing — only meaningful once a gameweek has scored. */
  rank: number | null;
  points: number;
  played: number;
  totalPlayers: number;
  gapToFirst: number | null;
}

export interface HomeLeagueCard {
  code: string;
  name: string;
  memberCount: number;
  /** The most recent chat line, already summarised for a card. */
  latest: { author: string; preview: string } | null;
  msgCount: number;
}

export interface FantasyHomeData {
  you: HomeYou;
  leagues: HomeLeagueCard[];
  moves: FeedEvent[];
  movesScope: "following" | "global";
  followingCount: number;
  /** Get-started nudges the user hasn't cleared — the client turns these into
   *  action cards, highest-value first. */
  todo: { squad: boolean; league: boolean; follow: boolean };
}

/** A chat message summarised to one line for a league card — kind-aware so a
 *  shared card never leaks its raw internal body ("shared their captain"). */
function previewOf(kind: string | null, body: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "player": return "📤 shared a player";
    case "captain": return "Ⓒ shared their captain";
    case "squad": return "👕 shared their squad";
    case "news": return `📰 ${typeof p.title === "string" ? p.title : "shared some news"}`;
    case "compare": return "⚖️ shared a comparison";
    case "poll": return `📊 ${typeof p.question === "string" ? p.question : "started a poll"}`;
    default: return body;
  }
}

export async function fantasyHome(db: Db, userId: string): Promise<FantasyHomeData> {
  // ── current gameweek + squad presence ──────────────────────────────────────
  const [{ data: gwRows }, { data: squadRow }] = await Promise.all([
    db.from("fantasy_gameweeks").select("gw, deadline, status, mode").eq("mode", "live").order("gw", { ascending: true }),
    db.from("fantasy_squads").select("user_id, xi").eq("user_id", userId).maybeSingle(),
  ]);
  const gws = (gwRows ?? []) as { gw: number; deadline: string | null; status: string }[];
  const current = gws.find((g) => g.status !== "final") ?? gws[gws.length - 1] ?? null;
  const hasSquad = !!squadRow && Array.isArray((squadRow as { xi?: unknown }).xi) && ((squadRow as { xi: unknown[] }).xi.length > 0);
  const deadline = current?.deadline ?? null;
  const dl = deadline ? new Date(deadline).getTime() : null;
  const phase: HomeYou["phase"] = current?.status === "final" ? "final"
    : dl != null && dl <= Date.now() ? "live" : "pre";

  // ── standing (season) ──────────────────────────────────────────────────────
  const standings = await loadGlobalStandings(db, userId, "season", 1);
  const you = standings.you;
  const leader = standings.rows[0] ?? null;

  const youOut: HomeYou = {
    hasSquad, gw: current?.gw ?? null, phase, deadline,
    rank: you && you.played > 0 ? you.rank : null,
    points: you?.points ?? 0,
    played: you?.played ?? 0,
    totalPlayers: standings.totalPlayers,
    gapToFirst: you && leader && you.played > 0 ? Math.max(0, leader.points - you.points) : null,
  };

  // ── league summary cards ───────────────────────────────────────────────────
  const { data: memberships } = await db.from("fantasy_league_members").select("league_id").eq("user_id", userId);
  const leagueIds = ((memberships ?? []) as { league_id: string }[]).map((m) => m.league_id);
  let leagues: HomeLeagueCard[] = [];
  if (leagueIds.length) {
    const [{ data: leagueRows }, { data: memberRows }, { data: msgRows }] = await Promise.all([
      db.from("fantasy_leagues").select("id, name, join_code").in("id", leagueIds),
      db.from("fantasy_league_members").select("league_id").in("league_id", leagueIds),
      db.from("comments").select("subject_id, user_id, body, kind, payload, created_at")
        .eq("subject_type", "fantasy_league").in("subject_id", leagueIds).is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    const counts = new Map<string, number>();
    ((memberRows ?? []) as { league_id: string }[]).forEach((m) => counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1));
    // latest message + count per league
    const latestByLeague = new Map<string, { user_id: string; body: string; kind: string | null; payload: unknown }>();
    const msgCount = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((msgRows ?? []) as any[]).forEach((m) => {
      msgCount.set(m.subject_id, (msgCount.get(m.subject_id) ?? 0) + 1);
      if (!latestByLeague.has(m.subject_id)) latestByLeague.set(m.subject_id, m);
    });
    const authorIds = Array.from(new Set(Array.from(latestByLeague.values()).map((m) => m.user_id)));
    const profById = new Map<string, string>();
    if (authorIds.length) {
      const { data: profs } = await db.from("profiles").select("id, display_name").in("id", authorIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profs ?? []).forEach((p: any) => profById.set(p.id, p.display_name ?? "A manager"));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    leagues = ((leagueRows ?? []) as any[]).map((l) => {
      const latest = latestByLeague.get(l.id);
      return {
        code: l.join_code, name: l.name, memberCount: counts.get(l.id) ?? 1,
        msgCount: msgCount.get(l.id) ?? 0,
        latest: latest ? { author: profById.get(latest.user_id) ?? "A manager", preview: previewOf(latest.kind, latest.body, latest.payload) } : null,
      };
    });
    // Busiest / most-recently-active leagues first.
    leagues.sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0) || b.msgCount - a.msgCount);
  }

  // ── other managers' moves (the feed spine) ─────────────────────────────────
  // Prefer the people you follow; fall back to the global feed so a cold user
  // still sees the game being played around them.
  const following = await loadFeed(db, userId, "following", "recent", 15);
  let moves = following.events;
  let movesScope: "following" | "global" = "following";
  if (moves.length < 4) {
    const global = await loadFeed(db, userId, "global", "recent", 15);
    // De-dupe against what we already have.
    const seen = new Set(moves.map((m) => m.id));
    moves = [...moves, ...global.events.filter((e) => !seen.has(e.id))].slice(0, 15);
    movesScope = following.events.length ? "following" : "global";
  }

  return {
    you: youOut,
    leagues,
    moves,
    movesScope,
    followingCount: following.followingCount,
    todo: { squad: !hasSquad, league: leagueIds.length === 0, follow: following.followingCount === 0 },
  };
}

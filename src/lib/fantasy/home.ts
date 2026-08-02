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
import { loadPublishedScoutPicks } from "./scoutPicks";
import { clientPool, enginePool } from "./pool";
import { pitchName, type BoardPlayer } from "./board";
import { PRESETS, buildPreset } from "./presets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface HomeBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain: number | null; vice: number | null }

export interface HomeScoutPick { category: string; id: number; name: string; club: string; pos: string; price: number; avatarUrl: string | null }

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
  /** The viewer's XI as a pitch board — so "Your squad is in" shows the squad. */
  board: HomeBoard | null;
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
  /** The Scout's picks this week — a highlight rail on the home. */
  scout: HomeScoutPick[];
  /** A ready-made legal squad for someone who hasn't picked yet — shown on the
   *  home so they can adopt it in one tap and start playing. Null once they have
   *  a squad (or if the pool is too thin to solve one). */
  proposed: { pickIds: number[]; players: BoardPlayer[] } | null;
  /** Get-started nudges the user hasn't cleared — the client turns these into
   *  action cards, highest-value first. */
  todo: { squad: boolean; league: boolean; follow: boolean };
}

/** The PUBLIC home for no-account browsers — the best of the live feed (real
 *  squads + portraits) with no personal data. Read-only; the join hook lives in
 *  the client. Kept deliberately thin so it never leaks anything private. */
export async function fantasyHomePublic(db: Db): Promise<{ moves: FeedEvent[]; scout: HomeScoutPick[] }> {
  const feed = await loadFeed(db, null, "global", "recent", 20);
  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));
  let scout: HomeScoutPick[] = [];
  try {
    const picks = await loadPublishedScoutPicks(db);
    scout = picks.filter((p) => !p.isBackup).map((p) => {
      const face = poolById.get(p.player.id);
      return { category: p.category, id: p.player.id, name: p.player.name, club: p.player.club, pos: p.player.pos, price: p.player.priceTenths / 10, avatarUrl: face?.avatarUrl ?? null };
    });
  } catch { /* none published */ }
  return { moves: feed.events, scout };
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
    db.from("fantasy_squads").select("xi, bench, captain, vice").eq("user_id", userId).maybeSingle(),
  ]);
  const gws = (gwRows ?? []) as { gw: number; deadline: string | null; status: string }[];
  const current = gws.find((g) => g.status !== "final") ?? gws[gws.length - 1] ?? null;
  const sq = squadRow as { xi?: number[]; bench?: number[]; captain?: number | null; vice?: number | null } | null;
  const hasSquad = !!sq && Array.isArray(sq.xi) && sq.xi.length > 0;

  // The viewer's XI as a pitch board, resolved from the pool (never trust the row
  // for names) — so the "You" strip can show the actual squad, not just words.
  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));
  const markerOf = (id: number): BoardPlayer => {
    const p = poolById.get(id);
    return { id, name: p?.name ?? `#${id}`, label: pitchName(p?.name ?? `#${id}`), pos: (p?.pos ?? "MID") as BoardPlayer["pos"], club: p?.club, avatarUrl: p?.avatarUrl ?? null };
  };
  const xi = hasSquad ? sq!.xi! : [];
  const bench = hasSquad && Array.isArray(sq!.bench) ? sq!.bench! : [];
  const board: HomeBoard | null = hasSquad
    ? { players: [...xi, ...bench].map(markerOf), xi, bench, captain: sq!.captain ?? null, vice: sq!.vice ?? null }
    : null;
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
    board,
  };

  // ── Scout highlight — this week's four picks, as a home rail ────────────────
  let scout: HomeScoutPick[] = [];
  try {
    const picks = await loadPublishedScoutPicks(db);
    scout = picks.filter((p) => !p.isBackup).map((p) => {
      const face = poolById.get(p.player.id);
      return { category: p.category, id: p.player.id, name: p.player.name, club: p.player.club, pos: p.player.pos, price: p.player.priceTenths / 10, avatarUrl: face?.avatarUrl ?? null };
    });
  } catch { /* no picks published yet — the tile just doesn't render */ }

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
  // The home feed is the WHOLE game — every manager's moves, not just the people
  // you follow (founder, 2 Aug). A manager sees the game being played around them
  // from day one, and following becomes a way to shape a feed that's already full.
  const global = await loadFeed(db, userId, "global", "recent", 15);
  const moves = global.events;

  return {
    you: youOut,
    leagues,
    moves,
    movesScope: "global",
    followingCount: global.followingCount,
    scout,
    proposed: hasSquad ? null : buildProposedSquad(markerOf),
    todo: { squad: !hasSquad, league: leagueIds.length === 0, follow: global.followingCount === 0 },
  };
}

/** A one-tap ready-made squad — a solved, legal "Balanced" preset. Returns null
 *  if the pool can't form a legal 15 (then the home just shows the build CTA). */
function buildProposedSquad(markerOf: (id: number) => BoardPlayer): { pickIds: number[]; players: BoardPlayer[] } | null {
  try {
    const shape = PRESETS.find((p) => p.id === "balanced") ?? PRESETS[0];
    const pickIds = buildPreset(shape, enginePool());
    if (pickIds.length !== 15) return null;
    return { pickIds, players: pickIds.map(markerOf) };
  } catch { return null; }
}

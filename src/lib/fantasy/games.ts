import "server-only";
/**
 * League Games tab overview (Phase 4A) — a read-time aggregation over
 * member_challenges for one league: what the viewer has to act on, what's
 * open across the whole league, recent results, and a leaderboard computed
 * fresh from completed rows. No admin settings this phase (locked): every
 * league has games enabled, every supported game, leaderboard always visible.
 *
 * Reuses challenges.ts's reconcile()/challengeCardsFor() rather than
 * re-deriving status — the SAME status machine the chat card and the accept/
 * decline routes already trust. This file adds nothing to that machine, it
 * only reads and partitions it for a second surface.
 *
 * The leaderboard is NEVER stored (locked, "computed ON READ") — every call
 * walks every completed, non-bot row this league has ever had. That's fine
 * at today's scale (a private league, hundreds of challenges at most); a
 * future league with thousands of completed games would want this cached,
 * not recomputed per request.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/fantasy/server";
import { reconcile, challengeCardsFor, type MemberChallengeRow, type ChallengeCardData } from "@/lib/fantasy/challenges";
import { supportedChallengeGames } from "@/lib/fantasy/challengeGames";
import { syntheticActors } from "@/lib/fantasy/feed";
import {
  pointsForResult, sortLeaderboard, deriveStreak, deriveGamesTabAction, resultForParticipant, formatGameResultLine,
  type LeaderboardCandidate, type GameResult, type CompletedGameForStreak, type GamesTabAction,
} from "@/lib/fantasy/games-pure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const OPEN_STATUSES = new Set(["pending", "accepted", "active", "awaiting_opponent"]);
// Same order of magnitude as leagueChat's own message window (chat.ts) —
// generous enough that a genuinely active league's whole history fits in one
// query, without an unbounded scan on a league that's been running for years.
const CHALLENGES_WINDOW = 200;
const RECENT_RESULTS_LIMIT = 12;
const LEADERBOARD_CAP = 50;
// League History's "GAMES" block (Phase 4B) — a longer look-back than the
// Games tab's own RECENT_RESULTS_LIMIT (12), since History is where a member
// goes to browse further back, not just "what just happened".
const HISTORY_RESULTS_LIMIT = 30;

/** Same membership check challenges.ts's requireMemberLeagueByCode performs,
 *  duplicated rather than imported — that version is a private, unexported
 *  helper in challenges.ts, kept that way for the same reason chat.ts's own
 *  requireMemberLeague is (see challenges.ts's own doc: importing across
 *  would make the two files import each other). */
async function requireMemberLeagueByCode(db: Db, code: string, userId: string): Promise<{ id: string; name: string }> {
  const { data: league } = await db.from("fantasy_leagues")
    .select("id, name").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!league) throw new HttpError(404, "league not found");
  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!member) throw new HttpError(403, "not in this league");
  return league as { id: string; name: string };
}

export interface GamesActionCard extends ChallengeCardData {
  action: GamesTabAction;
}
export interface GamesLeaderboardRow {
  userId: string; name: string; avatarUrl: string | null;
  played: number; wins: number; draws: number; losses: number; points: number;
}
export interface GamesSummary {
  open: number; wins: number; losses: number; draws: number;
  streakType: GameResult | null; streakCount: number;
}
/** `howItWorks` (Phase 4D) — the 2-3 line breakdown the game detail sheet
 *  renders verbatim, sourced from challengeGames.ts's own registry (never
 *  hardcoded in a component — see that file's doc). */
export interface GamesAvailableGame { id: string; name: string; shortDesc: string; typicalDuration: string; howItWorks: string[] }
export interface GamesOverview {
  actionRequired: GamesActionCard[];
  open: ChallengeCardData[];
  recentResults: ChallengeCardData[];
  leaderboard: GamesLeaderboardRow[];
  /** Null when the viewer has never opened OR completed a single challenge in
   *  this league — the compact status line has nothing to say then. */
  mySummary: GamesSummary | null;
  availableGames: GamesAvailableGame[];
}

/** The one query + reconcile + hydrate pass every Games surface for a league
 *  is built from: leagueGamesOverview (actionable/open/completed/leaderboard),
 *  leagueGamesPulse (the hub module's tiny status), and leagueGamesHistory
 *  (the History tab's "GAMES" block) all start here rather than each
 *  re-querying member_challenges — same "no duplicated status logic" rule
 *  the games-pure.ts doc follows for the pure math side of this file. */
async function fetchLeagueChallengeRows(db: Db, leagueId: string): Promise<{ reconciled: MemberChallengeRow[]; cardById: Map<string, ChallengeCardData> }> {
  const { data: rows } = await db.from("member_challenges")
    .select("*").eq("league_id", leagueId).order("created_at", { ascending: false }).limit(CHALLENGES_WINDOW);
  const mcRows = (rows ?? []) as MemberChallengeRow[];

  // Never surface a QA/health-bot drill on a real league's Games surfaces —
  // the same belt feed.ts's emitFeedEvent uses to keep bot traffic out of the
  // feed (see feed.ts's own doc on why these ids are hardcoded).
  const bots = syntheticActors();
  const realRows = mcRows.filter((r) => !bots.has(r.challenger_id) && !bots.has(r.opponent_id));

  const reconciled = await Promise.all(realRows.map((r) => reconcile(db, r)));
  const cardById = await challengeCardsFor(db, reconciled.map((r) => r.id));
  return { reconciled, cardById };
}

export async function leagueGamesOverview(db: Db, userId: string, code: string): Promise<GamesOverview> {
  const league = await requireMemberLeagueByCode(db, code, userId);
  const { reconciled, cardById } = await fetchLeagueChallengeRows(db, league.id);

  const actionRequired: GamesActionCard[] = [];
  const open: ChallengeCardData[] = [];
  const completed: { card: ChallengeCardData; row: MemberChallengeRow }[] = [];

  for (const row of reconciled) {
    const card = cardById.get(row.id);
    if (!card) continue; // defensive — challengeCardsFor returns one entry per id it actually found

    if (row.status === "completed") {
      completed.push({ card, row });
      continue;
    }
    if (!OPEN_STATUSES.has(row.status)) continue; // declined/expired/cancelled — nothing to surface on this tab

    const action = deriveGamesTabAction(
      {
        status: row.status, gameMode: card.gameMode,
        challengerId: row.challenger_id, opponentId: row.opponent_id,
        challengerDone: card.challengerDone, opponentDone: card.opponentDone,
      },
      userId,
    );
    if (action) actionRequired.push({ ...card, action });
    else open.push(card);
  }

  // Newest-by-WHEN-IT-FINISHED, not when it was sent.
  completed.sort((a, b) => new Date(b.row.completed_at ?? b.row.created_at).getTime() - new Date(a.row.completed_at ?? a.row.created_at).getTime());
  const recentResults: ChallengeCardData[] = completed.slice(0, RECENT_RESULTS_LIMIT).map((c) => c.card);

  // ── Leaderboard — every completed, non-bot row this league has, not just
  // the RECENT_RESULTS_LIMIT-capped slice above. ──
  const byUser = new Map<string, { played: number; wins: number; draws: number; losses: number; points: number; lastCompletedAt: string }>();
  const bump = (uid: string, result: GameResult, completedAt: string) => {
    const cur = byUser.get(uid) ?? { played: 0, wins: 0, draws: 0, losses: 0, points: 0, lastCompletedAt: completedAt };
    cur.played += 1;
    if (result === "win") cur.wins += 1;
    else if (result === "draw") cur.draws += 1;
    else cur.losses += 1;
    cur.points += pointsForResult(result);
    if (new Date(completedAt).getTime() > new Date(cur.lastCompletedAt).getTime()) cur.lastCompletedAt = completedAt;
    byUser.set(uid, cur);
  };
  for (const { card, row } of completed) {
    const completedAt = row.completed_at ?? row.created_at;
    bump(row.challenger_id, resultForParticipant(card.winnerId, row.challenger_id), completedAt);
    bump(row.opponent_id, resultForParticipant(card.winnerId, row.opponent_id), completedAt);
  }
  const leaderUserIds = Array.from(byUser.keys());
  const { data: profs } = leaderUserIds.length
    ? await db.from("profiles").select("id, display_name, username, avatar_url").in("id", leaderUserIds)
    : { data: [] as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[] };
  const profOf = new Map(((profs ?? []) as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
  const nameOf = (id: string) => {
    const p = profOf.get(id);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "Player");
  };

  const candidates: (LeaderboardCandidate & { name: string; avatarUrl: string | null })[] = leaderUserIds.map((uid) => {
    const s = byUser.get(uid)!;
    return {
      userId: uid, played: s.played, wins: s.wins, draws: s.draws, losses: s.losses, points: s.points,
      lastCompletedAt: s.lastCompletedAt, name: nameOf(uid), avatarUrl: profOf.get(uid)?.avatar_url ?? null,
    };
  });
  const leaderboard: GamesLeaderboardRow[] = sortLeaderboard(candidates).slice(0, LEADERBOARD_CAP)
    .map((c) => ({ userId: c.userId, name: c.name, avatarUrl: c.avatarUrl, played: c.played, wins: c.wins, draws: c.draws, losses: c.losses, points: c.points }));

  // ── mySummary — the viewer's own open count + completed record + streak. ──
  const myOpenCount = [...actionRequired, ...open]
    .filter((c) => c.challengerId === userId || c.opponentId === userId).length;
  const myCompleted = completed
    .filter((c) => c.row.challenger_id === userId || c.row.opponent_id === userId)
    .sort((a, b) => new Date(b.row.completed_at ?? b.row.created_at).getTime() - new Date(a.row.completed_at ?? a.row.created_at).getTime());
  const myResults: CompletedGameForStreak[] = myCompleted.map((c) => ({
    result: resultForParticipant(c.card.winnerId, userId),
    completedAt: c.row.completed_at ?? c.row.created_at,
  }));
  const streak = deriveStreak(myResults);
  const myWins = myResults.filter((r) => r.result === "win").length;
  const myDraws = myResults.filter((r) => r.result === "draw").length;
  const myLosses = myResults.filter((r) => r.result === "loss").length;
  const mySummary: GamesSummary | null = (myOpenCount > 0 || myCompleted.length > 0)
    ? { open: myOpenCount, wins: myWins, losses: myLosses, draws: myDraws, streakType: streak?.type ?? null, streakCount: streak?.count ?? 0 }
    : null;

  return {
    actionRequired,
    open,
    recentResults,
    leaderboard,
    mySummary,
    availableGames: supportedChallengeGames().map((g) => ({ id: g.id, name: g.name, shortDesc: g.shortDesc, typicalDuration: g.typicalDuration, howItWorks: g.howItWorks })),
  };
}

// ── Hub Games module pulse (Phase 4B) ────────────────────────────────────

export interface GamesPulse {
  /** Every OPEN_STATUSES row in the league right now — league-wide, not just
   *  the viewer's own (mirrors the Games tab's OPEN CHALLENGES section). */
  openCount: number;
  /** The viewer's own action-required count ONLY — same rule the Games tab
   *  badge (page.tsx) uses. Never league-wide activity (locked, brief §4). */
  myActionCount: number;
  /** formatGameResultLine() on the most recently completed game, or null if
   *  this league has never finished one. A secondary caption under the hub
   *  module's primary status line, never the primary line itself — the
   *  primary line is always one of the three fixed states in
   *  LeagueHub's gamesStatusLine(). */
  lastResultLine: string | null;
}

/** GET /api/fantasy/leagues/[code]/games/pulse's whole job — a few numbers,
 *  not the full GamesOverview (no leaderboard walk, no card list building):
 *  the Hub module and the Games tab's own badge (page.tsx) both need this on
 *  every league load, so it stays as light as fetchLeagueChallengeRows'
 *  shared pass allows rather than piggybacking leagueGamesOverview itself
 *  (which would compute the leaderboard the hub module never shows). */
export async function leagueGamesPulse(db: Db, userId: string, code: string): Promise<GamesPulse> {
  const league = await requireMemberLeagueByCode(db, code, userId);
  const { reconciled, cardById } = await fetchLeagueChallengeRows(db, league.id);

  let openCount = 0;
  let myActionCount = 0;
  let latestCompleted: { card: ChallengeCardData; completedAt: string } | null = null;

  for (const row of reconciled) {
    const card = cardById.get(row.id);
    if (!card) continue;

    if (row.status === "completed") {
      const completedAt = row.completed_at ?? row.created_at;
      if (!latestCompleted || new Date(completedAt).getTime() > new Date(latestCompleted.completedAt).getTime()) {
        latestCompleted = { card, completedAt };
      }
      continue;
    }
    if (!OPEN_STATUSES.has(row.status)) continue;

    openCount += 1;
    const action = deriveGamesTabAction(
      {
        status: row.status, gameMode: card.gameMode,
        challengerId: row.challenger_id, opponentId: row.opponent_id,
        challengerDone: card.challengerDone, opponentDone: card.opponentDone,
      },
      userId,
    );
    if (action) myActionCount += 1;
  }

  return {
    openCount,
    myActionCount,
    lastResultLine: latestCompleted ? formatGameResultLine(latestCompleted.card) : null,
  };
}

// ── League History "GAMES" block (Phase 4B) ──────────────────────────────

export interface GamesHistoryEntry {
  challengeId: string;
  h2hId: string | null;
  gameId: string; gameName: string;
  challengerId: string; challengerName: string; challengerAvatarUrl: string | null;
  opponentId: string; opponentName: string; opponentAvatarUrl: string | null;
  winnerId: string | null;
  challengerScore: number | null; opponentScore: number | null;
  completedAt: string;
}

/** GET /api/fantasy/leagues/[code]/games/history — completed challenges only,
 *  capped at HISTORY_RESULTS_LIMIT and newest-finished-first, for
 *  LeagueHistoryView's flat "GAMES" block (History is strictly per-gameweek
 *  buckets otherwise — see that component's own doc for why this rides a
 *  second small fetch rather than forcing results into a gameweek). */
export async function leagueGamesHistory(db: Db, userId: string, code: string): Promise<GamesHistoryEntry[]> {
  const league = await requireMemberLeagueByCode(db, code, userId);
  const { reconciled, cardById } = await fetchLeagueChallengeRows(db, league.id);

  const completed: { card: ChallengeCardData; row: MemberChallengeRow }[] = [];
  for (const row of reconciled) {
    const card = cardById.get(row.id);
    if (!card || row.status !== "completed") continue;
    completed.push({ card, row });
  }
  completed.sort((a, b) => new Date(b.row.completed_at ?? b.row.created_at).getTime() - new Date(a.row.completed_at ?? a.row.created_at).getTime());

  return completed.slice(0, HISTORY_RESULTS_LIMIT).map(({ card, row }) => ({
    challengeId: card.challengeId,
    h2hId: card.h2hId,
    gameId: row.game_type, gameName: card.gameName,
    challengerId: card.challengerId, challengerName: card.challengerName, challengerAvatarUrl: card.challengerAvatarUrl,
    opponentId: card.opponentId, opponentName: card.opponentName, opponentAvatarUrl: card.opponentAvatarUrl,
    winnerId: card.winnerId,
    challengerScore: card.challengerScore, opponentScore: card.opponentScore,
    completedAt: row.completed_at ?? row.created_at,
  }));
}

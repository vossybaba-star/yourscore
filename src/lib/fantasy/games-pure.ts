/**
 * games.ts — pure scoring/leaderboard/streak/action logic (Phase 4A, league
 * Games tab). Split out for the same reason challenges-pure.ts is (see that
 * file's own doc): games.ts pulls in `server-only` deps (challenges.ts's
 * reconcile, feed.ts's syntheticActors), so the pure math worth unit-testing
 * — points, leaderboard tie-break, streak derivation, and the Games tab's
 * "what does the viewer need to do" logic — lives here where a plain
 * `node --test` run can reach it.
 */

/** The scoring version stamped on the leaderboard's own math (distinct from
 *  member_challenges.scoring_version, which is per-GAME — quiz_battle_v1
 *  etc.). Not persisted anywhere today (the leaderboard is computed fresh on
 *  every read, never stored), kept as a named constant so a future change to
 *  the points formula has a version to bump rather than a silent behaviour
 *  change. */
export const LEAGUE_POINTS_SCORING_VERSION = "league_points_v1";

export type GameResult = "win" | "draw" | "loss";

/** Win 3 / draw 1 / loss 0 — locked (Phase 4A brief). */
export function pointsForResult(result: GameResult): number {
  return result === "win" ? 3 : result === "draw" ? 1 : 0;
}

export interface LeaderboardCandidate {
  userId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  /** This member's most recent completed game — the final tie-break axis. */
  lastCompletedAt: string;
}

/** Tie-break order (locked): points desc, then wins desc, then played desc,
 *  then EARLIEST last-completion. That last axis is deliberately the
 *  opposite of "most recently active" — a manager who set their record and
 *  went quiet doesn't get bumped by one who just matched it on volume. */
export function compareLeaderboardCandidates(a: LeaderboardCandidate, b: LeaderboardCandidate): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.played !== b.played) return b.played - a.played;
  return new Date(a.lastCompletedAt).getTime() - new Date(b.lastCompletedAt).getTime();
}

export function sortLeaderboard<T extends LeaderboardCandidate>(rows: T[]): T[] {
  return [...rows].sort(compareLeaderboardCandidates);
}

// ── Streak ────────────────────────────────────────────────────────────────

export interface CompletedGameForStreak {
  result: GameResult;
  completedAt: string;
}
export type Streak = { type: GameResult; count: number } | null;

/** Walk newest-to-oldest, counting a run of the SAME result. The caller
 *  (games.ts) must pass rows already sorted newest-first — this never
 *  re-sorts, so a caller passing oldest-first silently reads the wrong end
 *  of the run. Null when there's nothing completed yet. */
export function deriveStreak(rowsNewestFirst: CompletedGameForStreak[]): Streak {
  if (!rowsNewestFirst.length) return null;
  const type = rowsNewestFirst[0].result;
  let count = 0;
  for (const r of rowsNewestFirst) {
    if (r.result !== type) break;
    count++;
  }
  return { type, count };
}

// ── Games tab action derivation ──────────────────────────────────────────

/** What the Games tab's YOUR TURN card offers: "decline_or_play" is the
 *  initial accept/decline decision, "play" is a scorecard opponent's first
 *  attempt post-accept, "resume" is a duel side (either one) coming back to
 *  finish theirs. */
export type GamesTabAction = "decline_or_play" | "play" | "resume";

export interface ActionableChallenge {
  status: string;
  gameMode: "duel" | "scorecard";
  challengerId: string;
  opponentId: string;
  /** Duel only — always false/unused for scorecard (see challengeCardsFor's
   *  own doc in challenges.ts: a scorecard challenge has no "who's played"
   *  state to expose pre-result). */
  challengerDone: boolean;
  opponentDone: boolean;
}

/** What, if anything, the VIEWER has to do on an open challenge — YOUR TURN
 *  section membership. Null means "not actionable for this viewer": either
 *  they're a spectator (checked first), or it's genuinely someone else's
 *  move right now.
 *
 *   - pending, viewer is the opponent: the one-tap accept-then-play decision
 *     (Play/Decline both offered — same ChallengeCardMsg copy chat already
 *     uses). The challenger has nothing to do here (they're the one
 *     waiting), for BOTH scorecard and duel — a duel challenger CAN
 *     technically play their own side pre-accept (see ChallengeCardMsg's
 *     "Play your side" link), but that's a courtesy shortcut, not something
 *     required of them, so it isn't surfaced as actionable here.
 *   - scorecard (quiz_battle/gameday_quiz), active, viewer is the opponent:
 *     they've accepted but not yet played their FIRST attempt — the
 *     challenger already played at creation, so only the opponent is ever
 *     actionable in this mode.
 *   - duel, active or awaiting_opponent, viewer's own attempt not yet
 *     recorded: either side can be mid-duel (a duel has no "already played"
 *     side at creation, unlike scorecard) — "resume" covers both starting
 *     fresh and coming back to an abandoned attempt, since a duel is always
 *     an in-progress thing until both sides land.
 *
 *  Only meaningful for a row where the viewer IS the challenger or the
 *  opponent — a spectator always gets null regardless of status. */
export function deriveGamesTabAction(card: ActionableChallenge, viewerId: string): GamesTabAction | null {
  const viewerIsOpponent = viewerId === card.opponentId;
  const viewerIsChallenger = viewerId === card.challengerId;
  if (!viewerIsOpponent && !viewerIsChallenger) return null;

  if (card.status === "pending") return viewerIsOpponent ? "decline_or_play" : null;

  if (card.gameMode === "scorecard") {
    return card.status === "active" && viewerIsOpponent ? "play" : null;
  }

  // duel
  if (card.status === "active" || card.status === "awaiting_opponent") {
    const viewerDone = viewerIsChallenger ? card.challengerDone : card.opponentDone;
    if (!viewerDone) return "resume";
  }
  return null;
}

// ── Phase 4B/C/D — Games hub finishing pieces ────────────────────────────

/** win/draw/loss FOR ONE PARTICIPANT of a completed row. Only ever called on
 *  a row already known to be "completed" — winnerId is meaningless (and
 *  never read) for anything still open. Was a private `resultFor` duplicated
 *  in games.ts and re-derived ad hoc client-side (member gaming summary,
 *  Phase 4C) — pulled up here (no `server-only` import) so BOTH sides call
 *  the same one function rather than two copies drifting apart. */
export function resultForParticipant(winnerId: string | null, participantId: string): GameResult {
  if (winnerId === null) return "draw";
  return winnerId === participantId ? "win" : "loss";
}

/** Win rate as a whole-number percent — null when nobody's played yet (the
 *  member gaming summary sheet only shows this line when played > 0, per the
 *  4C brief; a 0/0 percentage has no honest value to print). */
export function winRatePercent(wins: number, played: number): number | null {
  if (played <= 0) return null;
  return Math.round((wins / played) * 100);
}

/** "X beat Y 8 v 7" / "X and Y finished level" — the one line describing a
 *  completed challenge's outcome, shared by the Games hub module's status
 *  line (games.ts's leagueGamesPulse), the league History "GAMES" block, and
 *  the Games tab itself, so a result reads identically everywhere it's
 *  quoted (house rule: no duplicated status logic). Never includes the game
 *  name or a timestamp — callers that want either append their own. */
export interface GameResultLineInput {
  challengerId: string;
  opponentId: string;
  challengerName: string;
  opponentName: string;
  challengerScore: number | null;
  opponentScore: number | null;
  winnerId: string | null;
}
export function formatGameResultLine(c: GameResultLineInput): string {
  if (c.winnerId === null) return `${c.challengerName} and ${c.opponentName} finished level`;
  const winnerIsChallenger = c.winnerId === c.challengerId;
  const winnerName = winnerIsChallenger ? c.challengerName : c.opponentName;
  const loserName = winnerIsChallenger ? c.opponentName : c.challengerName;
  const hasScores = typeof c.challengerScore === "number" && typeof c.opponentScore === "number";
  if (!hasScores) return `${winnerName} beat ${loserName}`;
  const winnerScore = winnerIsChallenger ? c.challengerScore : c.opponentScore;
  const loserScore = winnerIsChallenger ? c.opponentScore : c.challengerScore;
  return `${winnerName} beat ${loserName} ${winnerScore} v ${loserScore}`;
}

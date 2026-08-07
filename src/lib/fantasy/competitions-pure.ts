/**
 * competitions.ts — pure standings/status/copy logic (Wave 1 foundation).
 *
 * Split out for the same reason challenges-pure.ts is (see that file's own
 * doc): competitions.ts pulls in `import "server-only"`, which throws the
 * moment the module is `require()`d outside a React Server Component context
 * — so it cannot be loaded by a plain `node --test` run. The math worth unit
 * testing (status transitions, ranking, eligibility, result copy) lives here
 * where a bare `node --test` run can reach it; competitions.ts stays a thin
 * db-facing wrapper on top.
 */

// ── Status ────────────────────────────────────────────────────────────────

/** The two forward, time-driven transitions this wave owns. Every other
 *  status (draft, live, locked, calculating, completed, cancelled, void) is
 *  either DB-driven (settle-side, see competitions.ts's settleCompetition) or
 *  an unused extension point this wave never assigns (draft, live) — passed
 *  through unchanged rather than guessed at here. */
export interface CompetitionStatusInput {
  status: string;
  opensAt: string;
  closesAt: string;
}

/** Pure lazy-status calculator: given the row's CURRENT status and window,
 *  what should it read as right now? Computed directly from the window
 *  (rather than a single step at a time) so a reconcile call after a long gap
 *  fast-forwards straight to 'locked' without needing to land on 'open'
 *  first — competitions.ts's createCompetition/postCompetitionCard already
 *  guarantee a chat card exists from the moment of creation, so skipping the
 *  'open' status never means skipping the card.
 *
 *  Only 'scheduled' and 'open' are ever recomputed — every other status
 *  (settle-side or an unused extension point) passes through untouched, so
 *  this can be called on any row without checking its status first. */
export function deriveCompetitionStatus(row: CompetitionStatusInput, now: Date): string {
  if (row.status !== "scheduled" && row.status !== "open") return row.status;
  const t = now.getTime();
  const closesAt = new Date(row.closesAt).getTime();
  if (t >= closesAt) return "locked";
  const opensAt = new Date(row.opensAt).getTime();
  if (t >= opensAt) return "open";
  return "scheduled";
}

// ── Eligibility ───────────────────────────────────────────────────────────

/** An attempt only counts toward a competition if it landed inside the
 *  window — [opensAt, closesAt), closesAt exclusive so an attempt that lands
 *  in the same instant the window locks doesn't sneak in. An attempt
 *  completed BEFORE opens_at is excluded, not errored: quiz_attempts' unique
 *  (user_id, pack_id) index means someone who played the pack before the
 *  competition existed physically cannot re-enter — this is what makes that
 *  fact visible in the standings (they simply never appear) rather than a
 *  silent crash somewhere downstream. */
export function isEligibleAttempt(
  attempt: { completedAt: string }, opensAt: string, closesAt: string,
): boolean {
  const t = new Date(attempt.completedAt).getTime();
  return t >= new Date(opensAt).getTime() && t < new Date(closesAt).getTime();
}

/** True when a viewer has a scorecard for this competition's pack that exists
 *  but falls outside the window (isEligibleAttempt's own doc above — almost
 *  always: they played it before the competition opened). Distinct from
 *  "hasn't played yet": that reads as `null` here, not `false` — the detail
 *  sheet needs to tell those two apart (nothing to explain vs. something to
 *  explain) and a boolean alone can't carry that. quiz_attempts is unique per
 *  (user_id, pack_id), so an ineligible attempt can never be replayed into an
 *  eligible one — this is what makes that exclusion visible to the one
 *  person it actually affects, instead of just an absence from the standings. */
export function viewerIneligibleReason(
  attempt: { completedAt: string } | null, opensAt: string, closesAt: string,
): boolean | null {
  if (!attempt) return null;
  return !isEligibleAttempt(attempt, opensAt, closesAt);
}

// ── Ranking ───────────────────────────────────────────────────────────────

export interface QuizAttemptForRanking {
  userId: string;
  score: number;
  completedAt: string;
}

/** Deterministic total order shared by both formats below: score desc, then
 *  EARLIER completion wins a tie (rewards finishing first, not last), then
 *  userId asc as the final decider — equal score AND equal timestamp is
 *  practically impossible (millisecond precision), but a pure function must
 *  still return the same answer every time it's called with the same input,
 *  so nothing is left to sort() stability. */
function compareByScoreThenTime(a: QuizAttemptForRanking, b: QuizAttemptForRanking): number {
  if (a.score !== b.score) return b.score - a.score;
  const at = new Date(a.completedAt).getTime();
  const bt = new Date(b.completedAt).getTime();
  if (at !== bt) return at - bt;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

export interface RankedEntry extends QuizAttemptForRanking {
  rank: number;
}

/** league_quiz standings: score desc, tie → earlier completion, tie → userId
 *  — a strict total order, so rank is always a plain 1..N ordinal (never a
 *  shared/skipped rank — ties in the mathematical sense never reach here). */
export function rankLeagueQuiz(attempts: QuizAttemptForRanking[]): RankedEntry[] {
  return [...attempts].sort(compareByScoreThenTime).map((a, i) => ({ ...a, rank: i + 1 }));
}

export type BeatTargetResult = "placed" | "played";

export interface BeatTargetEntry extends QuizAttemptForRanking {
  result: BeatTargetResult;
}

/** beat_target standings: every attempt scoring >= target is 'placed'
 *  (everyone who beats the target is a winner — no single-winner rule),
 *  everyone else is 'played'. Placed entries lead the list, both groups
 *  individually ordered score desc (same tie-break as rankLeagueQuiz) — this
 *  is a display order, not a competitive rank (beat_target has no rank
 *  column meaning). */
export function resolveBeatTarget(attempts: QuizAttemptForRanking[], target: number): BeatTargetEntry[] {
  const withResult = attempts.map((a) => ({ ...a, result: (a.score >= target ? "placed" : "played") as BeatTargetResult }));
  const placed = withResult.filter((a) => a.result === "placed").sort(compareByScoreThenTime);
  const played = withResult.filter((a) => a.result === "played").sort(compareByScoreThenTime);
  return [...placed, ...played];
}

// ── Result copy ───────────────────────────────────────────────────────────

export type CompetitionFormatId = "league_quiz" | "beat_target";

export interface CompetitionResultLineInput {
  format: CompetitionFormatId;
  entrantCount: number;
  /** league_quiz only — the rank-1 entrant's display name, once settled. */
  winnerName: string | null;
  /** beat_target only — how many attempts scored >= target. */
  placedCount: number;
}

/** The one line describing a settled competition's outcome — chat result
 *  card and notification body both read off this, so the copy never drifts
 *  between the two surfaces (same rule formatGameResultLine in games-pure.ts
 *  follows for challenges). House style: zero dashes of any kind, "friend"
 *  never "mate", no emoji. */
export function competitionResultLine(input: CompetitionResultLineInput): string {
  if (input.entrantCount === 0) return "Nobody entered this one";

  if (input.format === "beat_target") {
    if (input.placedCount === 0) return `Nobody beat the target this time. ${input.entrantCount} played`;
    if (input.placedCount === 1) return "One friend beat the target";
    return `${input.placedCount} friends beat the target`;
  }

  // league_quiz
  if (!input.winnerName) return "The league quiz finished with no result";
  return `${input.winnerName} won the league quiz`;
}

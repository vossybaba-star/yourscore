/**
 * The challenge game registry (Phase 1C) — the single list of games a
 * league-mate challenge can be played over. Shared by client and server (no
 * "server-only" here): the prep sheet reads it to render the one supported
 * game card, and challenges.ts reads it to gate createChallenge.
 *
 * UNSUPPORTED GAMES ARE NEVER RENDERED — founder's call: Quiz Battle only for
 * now, no greyed-out "coming soon" cards for gameday_quiz / 38_0. They're
 * listed here so the shape of a future adapter is documented in one place,
 * not because the UI should show them.
 */

export interface ChallengeGame {
  id: string;
  name: string;
  shortDesc: string;
  /** A rough sense of the time commitment, for the prep sheet's game card. */
  typicalDuration: string;
  /** True if the opponent can play whenever, rather than both sides live at
   *  once. Every challenge game here is async (no synchronous game exists
   *  yet — a live/synchronous variant would need its own "waiting room"
   *  adapter, not just a new registry entry). */
  async: boolean;
  /** Whether createChallenge (challenges.ts) and the prep sheet will
   *  actually let you start one. False = documented, not offered. */
  supported: boolean;
}

/**
 * quiz_battle — the only playable game today.
 *
 * Winner: once BOTH sides have a score on the linked h2h_challenges row
 * (challenger_score always set at creation; opponent_score set the moment
 * they play, server-graded in /api/h2h/play), the higher score wins.
 * Tie: equal scores → the challenge completes with winner_id null ("It
 * finished level" in the chat card) — no tiebreaker, no replay.
 * Expiry: rides the h2h challenge's OWN expires_at (3 days from creation,
 * same constant createChallenge uses for the h2h insert) — there's no
 * separate quiz_battle expiry to keep in step; reconcile() reads the linked
 * h2h row's expires_at, not member_challenges.expires_at, as the source of
 * truth for "has this gone stale" (member_challenges.expires_at is set to
 * match it at creation, for cheap listing/sorting without a join).
 * Adapter shape it uses: result_id = h2h_challenges.id; the score/grading/
 * play surface is entirely /h2h/[id] + /api/h2h/play, unchanged by this
 * feature — member_challenges is a thin pointer + lifecycle wrapper on top.
 */
export const CHALLENGE_GAMES: ChallengeGame[] = [
  {
    id: "quiz_battle",
    name: "Quiz Battle",
    shortDesc: "Send a quiz you've already played. They've got a few days to beat your score.",
    typicalDuration: "A few minutes",
    async: true,
    supported: true,
  },
  {
    id: "gameday_quiz",
    name: "Gameday Quiz",
    shortDesc: "The per-fixture matchday pack, head to head.",
    typicalDuration: "A few minutes",
    async: true,
    // Not offered yet. An adapter would need: a way to create a challenge
    // BEFORE either side has played (gameday quiz results aren't a replayable
    // stored attempt the way quiz_attempts is — see createChallenge's Quiz
    // Battle step, which reads an EXISTING attempt), its own result table
    // (or a gameday-specific row on h2h_challenges) to point result_id at,
    // and a winner rule for what happens if the fixture itself is postponed
    // (today's expiry model assumes the game itself doesn't move).
    supported: false,
  },
  {
    id: "38_0",
    name: "38-0",
    shortDesc: "Head to head on a 38-0 run.",
    typicalDuration: "A few minutes",
    async: true,
    // Not offered yet. 38-0 has no stored "attempt" table today the way quiz
    // packs have quiz_attempts, so there's nothing for createChallenge to
    // read at challenge time — an adapter needs its own authoritative score
    // record (or a live head-to-head run) before result_id has anywhere to
    // point, plus a winner rule (38-0 scores aren't a simple higher-is-better
    // comparison across every mode — pens/League removal already changed
    // what "a run" means once this season).
    supported: false,
  },
];

export function challengeGame(id: string): ChallengeGame | undefined {
  return CHALLENGE_GAMES.find((g) => g.id === id);
}

export function supportedChallengeGames(): ChallengeGame[] {
  return CHALLENGE_GAMES.filter((g) => g.supported);
}

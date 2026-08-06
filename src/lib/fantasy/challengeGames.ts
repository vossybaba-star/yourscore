/**
 * The challenge game registry (Phase 1C, expanded Phase 3B) — the single list
 * of games a league-mate challenge can be played over. Shared by client and
 * server (no "server-only" here): the prep sheet reads it to render every
 * supported game as a card, and challenges.ts reads it to gate createChallenge.
 *
 * UNSUPPORTED GAMES ARE NEVER RENDERED — founder's call: no greyed-out
 * "coming soon" cards. They're listed here so the shape of a future adapter
 * is documented in one place, not because the UI should show them. 38-0
 * stays unsupported this phase.
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
  /** 2-3 short lines for the Games tab's game detail sheet (Phase 4D) —
   *  written straight off this file's own adapter doc comments above each
   *  entry, so the detail sheet never hardcodes game copy of its own. */
  howItWorks: string[];
}

/**
 * quiz_battle — send a quiz you've ALREADY played; they've got a few days to
 * beat your stored scorecard.
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
    howItWorks: [
      "Send a scorecard you've already played.",
      "They've got a few days to beat it, or not.",
      "Higher score wins. Level scores finish level.",
    ],
    supported: true,
  },
  {
    id: "quiz_duel",
    name: "Quiz Duel",
    shortDesc: "Pick a quiz neither of you has played. You both play it fresh. Best score wins.",
    typicalDuration: "A few minutes",
    async: true,
    howItWorks: [
      "A fresh pack. Neither of you has played it.",
      "Scores stay private until you've both finished.",
      "Best score wins.",
    ],
    // Phase 3B. The h2h_challenges row is created BEFORE anyone has a score
    // (mode 'duel', challenger_score/correct/answers null at insert — see
    // migration 259, which drops their NOT NULL constraints for this). Each
    // side's play is graded and held in h2h_duel_attempts (RLS: own row only —
    // h2h_challenges itself is public-read, so an in-progress duel score
    // can't live there without leaking) until BOTH exist, at which point
    // /api/h2h/play copies both onto the public h2h row and flips it
    // complete — the ONLY moment a duel's answers/scores become world-
    // readable. Winner: higher combined score once both attempts exist; tie
    // → null. See deriveDuelOutcome in challenges-pure.ts.
    supported: true,
  },
  {
    id: "gameday_quiz",
    name: "Gameday Quiz",
    shortDesc: "A matchday pack, head to head.",
    typicalDuration: "A few minutes",
    async: true,
    howItWorks: [
      "A matchday pack, head to head.",
      "Same rules as Quiz Battle. Beat their stored score.",
      "Higher score wins. Level scores finish level.",
    ],
    // Phase 3B. Same adapter as Quiz Battle end to end — an existing
    // quiz_attempts scorecard published as an h2h_challenges row (mode
    // 'scorecard'), scoring_version 'gameday_quiz_v1' — the only addition is
    // createChallenge rejecting a pack that doesn't carry the gameday
    // metadata marker (quiz_packs.metadata.gameday, set by
    // gameday/publish.ts's ensurePackRow; recap packs carry metadata.recap
    // instead and don't qualify). The old doc here claimed gameday needed
    // its own result table — it doesn't: a gameday attempt is a normal
    // quiz_attempts row (published via the same solo-complete path any other
    // pack uses), so the "existing scorecard" trust model Quiz Battle already
    // has just works.
    supported: true,
  },
  {
    id: "38_0",
    name: "38-0",
    shortDesc: "Head to head on a 38-0 run.",
    typicalDuration: "A few minutes",
    async: true,
    howItWorks: ["Not offered yet."],
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

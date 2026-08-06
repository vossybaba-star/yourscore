/**
 * The league competition format registry (Wave 1 foundation) — the single
 * list of formats a league-wide competition can run as. Shared by client and
 * server (no "server-only" here, mirroring challengeGames.ts): a future admin
 * create sheet reads it to render every supported format as a card,
 * competitions.ts reads it to gate createCompetition.
 *
 * UNSUPPORTED FORMATS ARE NEVER RENDERED (same founder's call as
 * challengeGames.ts) — no greyed-out "coming soon" cards. They're listed here
 * so the shape of a future adapter is documented in one place, not because
 * the UI should show them.
 */

export interface CompetitionFormat {
  id: string;
  name: string;
  shortDesc: string;
  /** Whether createCompetition (competitions.ts) will actually let a caller
   *  start one. False = documented, not offered. */
  supported: boolean;
  /** 2-3 short lines for a future format detail sheet — written straight off
   *  this file's own adapter doc comments, so a detail view never hardcodes
   *  format copy of its own (same convention as challengeGames.ts). */
  howItWorks: string[];
}

/**
 * league_quiz — every league member plays the SAME pack inside the window;
 * highest score wins. The default shape for an official Gameday competition
 * (see competitions.ts's ensureOfficialGamedayCompetitions) and available to
 * an admin-created one too.
 *
 * Winner: rank 1 of rankLeagueQuiz (competitions-pure.ts) once the window
 * locks and settlement runs — score desc, tie broken by earlier completion,
 * then userId as the final deterministic tiebreak (no replay, no draw state
 * at the top — someone always ranks first once there's at least one eligible
 * entrant).
 * Adapter shape: pack_id is required at creation; standings are computed
 * fresh from quiz_attempts (eligible window only — see isEligibleAttempt),
 * never a second scoring table.
 */
const LEAGUE_QUIZ_HOW: string[] = [
  "Everyone in the league plays the same pack.",
  "Play any time before the window closes.",
  "Highest score when it locks wins.",
];

/**
 * beat_target — every league member plays the SAME pack; anyone who scores
 * at or above the target is a winner, no cap on how many. No single-winner
 * rank: winner_user_id stays null on a beat_target competition even once
 * completed (see settleCompetition in competitions.ts).
 *
 * Winner(s): resolveBeatTarget (competitions-pure.ts) — 'placed' for every
 * attempt scoring >= target_score, 'played' otherwise. target_score is
 * required (> 0) at creation.
 */
const BEAT_TARGET_HOW: string[] = [
  "Everyone in the league plays the same pack.",
  "Beat the target score to place.",
  "Everyone who beats it is a winner. No cap.",
];

export const COMPETITION_FORMATS: CompetitionFormat[] = [
  {
    id: "league_quiz",
    name: "League Quiz",
    shortDesc: "Everyone plays the same pack. Highest score wins.",
    howItWorks: LEAGUE_QUIZ_HOW,
    supported: true,
  },
  {
    id: "beat_target",
    name: "Beat the Target",
    shortDesc: "Everyone plays the same pack. Beat the target score to place.",
    howItWorks: BEAT_TARGET_HOW,
    supported: true,
  },
  {
    id: "prediction_battle",
    name: "Prediction Battle",
    shortDesc: "Not offered yet.",
    howItWorks: ["Not offered yet."],
    // Not offered yet. Needs its own authoritative prediction/result table
    // (score/points don't come from quiz_attempts at all here) and a scoring
    // rule for a prediction that only resolves once the real match does —
    // neither exists today.
    supported: false,
  },
  {
    id: "captain_call",
    name: "Captain Call",
    shortDesc: "Not offered yet.",
    howItWorks: ["Not offered yet."],
    // Not offered yet. Would score off each member's fantasy captain pick for
    // a gameweek (fantasy_entries), not a quiz_attempts scorecard — a
    // different adapter shape from both formats above.
    supported: false,
  },
  {
    id: "league_cup",
    name: "League Cup",
    shortDesc: "Not offered yet.",
    howItWorks: ["Not offered yet."],
    // Not offered yet. A knockout bracket over member_challenges rounds — its
    // own multi-round state machine, not a single-window competition like
    // league_quiz/beat_target.
    supported: false,
  },
];

export function competitionFormat(id: string): CompetitionFormat | undefined {
  return COMPETITION_FORMATS.find((f) => f.id === id);
}

export function supportedCompetitionFormats(): CompetitionFormat[] {
  return COMPETITION_FORMATS.filter((f) => f.supported);
}

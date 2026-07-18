// The Quiz Battle CPU opponent — client-safe constants (no server imports).
// One dedicated auth user backs every CPU match (created 2026-07-03). It never
// earns global rank points (the answer route skips increment_profile_score for
// it), so it can't pollute leaderboards or the ready-to-play rail.
export const QUIZ_BOT_ID = "8b3660cc-ba29-409c-a6a6-5723bafa87a1";
export const QUIZ_BOT_NAME = "CPU";

/** Lobby name that marks a room as instant-matchmade (vs hand-created). Lives
 *  here (not quiz-matchmaking.ts, which is server-only) so client pages can
 *  recognise these rooms — e.g. the lobby hides its invite code/QR for them. */
export const INSTANT_MATCH_NAME = "Instant Match";

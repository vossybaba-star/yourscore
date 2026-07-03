// The Quiz Battle CPU opponent — client-safe constants (no server imports).
// One dedicated auth user backs every CPU match (created 2026-07-03). It never
// earns global rank points (the answer route skips increment_profile_score for
// it), so it can't pollute leaderboards or the ready-to-play rail.
export const QUIZ_BOT_ID = "8b3660cc-ba29-409c-a6a6-5723bafa87a1";
export const QUIZ_BOT_NAME = "CPU";

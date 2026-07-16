-- When this Player's device first played, captured client-side on the first play
-- and persisted at signup by /api/profile/source. Guest plays never reach the DB
-- (they're client-side and sign-up gated), so this is the only record that a Player
-- was already playing BEFORE they registered.
--
-- Read it against created_at (the signup moment):
--   first_play_at < created_at  → played as a guest first; the campaign re-registered
--                                 an existing player rather than winning a new one.
--   created_at - first_play_at  → how long they'd been playing before signing up.
-- Written once, never overwritten (first-touch), same as device_id in 81.
alter table profiles
  add column if not exists first_play_at timestamptz;

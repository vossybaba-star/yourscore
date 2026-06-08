-- 20_draft_league_live.sql
-- Leagues go Live-H2H-only: a league match is a directed live challenge (one
-- member invites another; the opponent accepts and both drop into the existing
-- live two-half engine, which already credits the league board on finalize).
-- Plus lightweight presence so a league's "online" dot is honest. ADDITIVE.

begin;

-- 1. Directed challenges: a lobby match aimed at one specific opponent. Unlike a
--    friend lobby (shareable join_code, anyone can claim p2), only invited_id may
--    accept. null for queue/bot/friend matches.
alter table draft_live_matches
  add column if not exists invited_id uuid references auth.users(id) on delete set null;
create index if not exists draft_live_invited_idx
  on draft_live_matches (invited_id, phase);

-- 2. The invited player must be able to SELECT the pending invite (so the league
--    board can read it and Realtime can stream it before they've claimed p2).
drop policy if exists "draft_live participants read" on draft_live_matches;
create policy "draft_live participants read" on draft_live_matches
  for select using (
    auth.uid() = p1_id or auth.uid() = p2_id or auth.uid() = invited_id
  );

-- 3. League presence heartbeat: bumped whenever a member loads the league board,
--    so "online" means "active in the last ~75s", not just "has saved a team".
alter table draft_league_members
  add column if not exists last_seen_at timestamptz;

commit;

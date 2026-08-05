-- 255_member_challenges.sql
-- Phase 1C: the challenge FOUNDATION — a game-agnostic wrapper around a
-- league-mate challenge, so a challenge's lifecycle (pending/declined/expired/
-- completed) is tracked in ONE place no matter which game it points at.
--
-- Today the only playable game is Quiz Battle: member_challenges.result_id
-- points at the h2h_challenges row that actually carries the quiz, the score
-- and the grading (see src/lib/fantasy/challenges.ts / challengeGames.ts). A
-- future game (gameday_quiz, 38_0 — see challengeGames.ts) adds its own
-- result_id-pointed table and its own adapter; this table's shape doesn't
-- change.
--
-- Security posture matches migration 61 (group_challenges): RLS restricts
-- SELECT to the two participants; there is NO insert/update/delete policy —
-- every write goes through a service-role API route
-- (src/app/api/fantasy/challenges/*), so status transitions stay authoritative
-- (createChallenge / declineChallenge / reconcile in challenges.ts).

create table if not exists member_challenges (
  id             uuid primary key default gen_random_uuid(),
  challenger_id  uuid not null references auth.users(id) on delete cascade,
  opponent_id    uuid not null references auth.users(id) on delete cascade,
  league_id      uuid not null references fantasy_leagues(id) on delete cascade,
  game_type      text not null default 'quiz_battle',
  status         text not null default 'pending'
                   check (status in ('draft', 'pending', 'accepted', 'declined', 'expired', 'active', 'completed', 'cancelled')),
  -- The game-specific session this challenge rides. For quiz_battle, an
  -- h2h_challenges.id (text so a future game's id shape isn't assumed to be a uuid).
  result_id      text,
  winner_id      uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  expires_at     timestamptz not null default (now() + interval '3 days'),
  started_at     timestamptz,
  completed_at   timestamptz
);

create index if not exists member_challenges_challenger_idx on member_challenges (challenger_id);
create index if not exists member_challenges_opponent_idx   on member_challenges (opponent_id);
create index if not exists member_challenges_league_idx     on member_challenges (league_id);

-- One OPEN (pending) challenge per (challenger, opponent, game) at a time —
-- the backstop createChallenge's own pre-check relies on. Doesn't stop the
-- REVERSE pair (opponent challenging challenger back) — that's a deliberate,
-- separate challenge, reconciled/blocked at the application layer instead
-- (pairStatus checks both directions for the UI's chip state).
create unique index if not exists member_challenges_open_pair_idx
  on member_challenges (challenger_id, opponent_id, game_type)
  where status = 'pending';

alter table member_challenges enable row level security;

drop policy if exists member_challenges_participant_read on member_challenges;
create policy member_challenges_participant_read on member_challenges
  for select using (auth.uid() = challenger_id or auth.uid() = opponent_id);

-- No insert/update/delete policy — service role only (see file doc above).

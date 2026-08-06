-- 260_league_competitions.sql
-- Wave 1: league-wide competitions foundation. Distinct from member_challenges
-- (255/258/259) — a challenge is always exactly two players; a competition is
-- every member of a league racing the same pack over a shared window. Two
-- tables mirror that shape: league_competitions (the window + rules) and
-- league_competition_entries (the frozen, per-member result, written once at
-- settlement — see settleCompetition in src/lib/fantasy/competitions.ts).
--
-- Status machine (src/lib/fantasy/competitions-pure.ts's deriveCompetitionStatus
-- owns the two lazy, time-driven transitions; everything past 'locked' is
-- DB-driven, settle-side, in competitions.ts's settleCompetition):
--   draft       — unused this wave (extension point for a future "review
--                 before it opens" step).
--   scheduled   — created, opens_at still in the future.
--   open        — opens_at has passed; entries (quiz_attempts within the
--                 window) count.
--   live        — unused this wave (extension point for a format whose
--                 window is a live, synchronous event rather than "play
--                 whenever before it closes").
--   locked      — closes_at has passed; no further attempt counts.
--   calculating — settlement claimed this row (atomic status-guarded update,
--                 same idempotency pattern as member_challenges' reconcile) —
--                 only the update that wins this transition computes/writes
--                 standings.
--   completed   — standings frozen into league_competition_entries,
--                 winner_user_id set (league_quiz only — beat_target has no
--                 single winner), result posted once.
--   cancelled   — an admin-created competition withdrawn (scheduled/open
--                 only) via the /cancel route. Official competitions can't be
--                 cancelled this wave.
--   void        — settled with zero eligible entrants. Same terminal shape as
--                 completed, minus the result card/notification (a quiet
--                 card state, not a result worth announcing).
--
-- Security posture matches 255/258/259: RLS restricts SELECT to league
-- members; there is NO insert/update/delete policy on either table — every
-- write goes through the service-role client
-- (src/lib/fantasy/competitions.ts / the /api/fantasy/leagues/[code]/competitions/*
-- routes), so status transitions stay authoritative.

create table if not exists league_competitions (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references fantasy_leagues(id) on delete cascade,
  format         text not null check (format in ('league_quiz', 'beat_target')),
  status         text not null default 'scheduled'
                   check (status in (
                     'draft', 'scheduled', 'open', 'live', 'locked',
                     'calculating', 'completed', 'cancelled', 'void'
                   )),
  source         text not null check (source in ('official', 'admin')),
  -- Null for an 'official' competition (the cron creates it, nobody did) —
  -- the league owner for an 'admin' one (createCompetition's own gate).
  created_by     uuid references auth.users(id) on delete set null,
  pack_id        uuid references quiz_packs(id) on delete set null,
  target_score   numeric,
  title          text not null,
  opens_at       timestamptz not null,
  closes_at      timestamptz not null,
  settled_at     timestamptz,
  -- Idempotent-creation key for a recurring official competition (e.g.
  -- `gameday:<packId>`) — the unique partial index below is what makes
  -- ensureOfficialGamedayCompetitions safe to call more than once for the
  -- same pack. Null for an admin one-off (no recurrence).
  recurrence_key text,
  -- Extension point, unused this wave — a future "series" of competitions
  -- (e.g. a monthly league quiz chain) would share one series_key the way a
  -- challenge rematch chain shares one series_id (migration 258).
  series_key     text,
  scoring_version text not null,
  winner_user_id uuid references auth.users(id) on delete set null,
  entrant_count  int,
  created_at     timestamptz not null default now()
);

-- One competition per (league, recurrence_key) — the idempotency backstop
-- ensureOfficialGamedayCompetitions relies on (createCompetition's 23505
-- handler reads the existing row back rather than erroring the caller).
create unique index if not exists league_competitions_recurrence_idx
  on league_competitions (league_id, recurrence_key) where recurrence_key is not null;

-- The two read patterns competitions.ts's competitionsForLeague and the
-- fantasy-tick sweep run constantly: "this league's active/recent
-- competitions" and "everything due for a status sweep".
create index if not exists league_competitions_league_status_idx
  on league_competitions (league_id, status);
create index if not exists league_competitions_status_closes_idx
  on league_competitions (status, closes_at);

alter table league_competitions enable row level security;

drop policy if exists league_competitions_member_read on league_competitions;
create policy league_competitions_member_read on league_competitions
  for select using (
    exists (
      select 1 from fantasy_league_members m
      where m.league_id = league_competitions.league_id and m.user_id = auth.uid()
    )
  );

-- No insert/update/delete policy — service role only (see file doc above).

create table if not exists league_competition_entries (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references league_competitions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  score          numeric,
  rank           int,
  result         text check (result in ('winner', 'placed', 'played')),
  -- The quiz_attempts.id this entry was frozen from — a pointer back to the
  -- scorecard, not a copy of its answers (competitions never duplicate
  -- attempt content, same as member_challenges pointing at h2h_challenges
  -- rather than owning a second copy of the questions/answers).
  attempt_id     uuid references quiz_attempts(id) on delete set null,
  entered_at     timestamptz not null default now(),
  settled_at     timestamptz,
  unique (competition_id, user_id)
);

create index if not exists league_competition_entries_competition_idx
  on league_competition_entries (competition_id);

alter table league_competition_entries enable row level security;

drop policy if exists league_competition_entries_member_read on league_competition_entries;
create policy league_competition_entries_member_read on league_competition_entries
  for select using (
    exists (
      select 1 from league_competitions c
      join fantasy_league_members m on m.league_id = c.league_id
      where c.id = league_competition_entries.competition_id and m.user_id = auth.uid()
    )
  );

-- No insert/update/delete policy — service role only (see file doc above).

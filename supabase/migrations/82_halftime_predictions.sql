-- Halftime prediction poll — the second-half engagement hook.
--
-- The hard content rule (migration 80 / spec §2.1) forbids any question about
-- something that happened AFTER the kickoff whistle, so a halftime pack can never
-- ask about the first half it is played during. The prediction poll is how we
-- "settle that" (founder, 2026-07-14): at the end of every halftime pack the fan
-- makes ONE call on the second half — who wins — and we grade it at full time.
-- That gives the pack a live stake without a single question depending on a live
-- event.
--
-- Two tables, both ADDITIVE and both deny-all RLS (like halftime_releases): every
-- read and write goes through the /api/halftime/predict + settle routes under the
-- service role, so the tally (how many fans picked each side) is computed
-- server-side and one fan can never read another's pick directly.
--
-- LOCKED: a pick is made ONCE and cannot be changed. Enforced structurally — the
-- PRIMARY KEY (user_id, fixture_id) allows a single row per fan per fixture, and
-- there is NO update policy, so a client holding a valid session cannot edit a
-- prediction after watching more of the second half. (Same lock shape as
-- club_supporters, migration 81.)

begin;

-- 1. One prediction per fan per fixture ----------------------------------------

create table if not exists halftime_predictions (
  user_id    uuid   not null references profiles(id) on delete cascade,
  fixture_id bigint not null,                 -- SportMonks fixture id (halftime_releases.fixture_id)
  pack_id    uuid   not null,                 -- the halftime pack they had just played
  pick       text   not null check (pick in ('home', 'draw', 'away')),
  correct    boolean,                         -- null until the fixture is settled at FT
  created_at timestamptz not null default now(),

  -- One pick per fan per fixture, and (with no update policy, §3) unchangeable.
  primary key (user_id, fixture_id)
);

-- Settlement and the tally both scan by fixture.
create index if not exists halftime_predictions_fixture_idx
  on halftime_predictions (fixture_id);

-- 2. The full-time result that settles a fixture -------------------------------
-- Written once per fixture by the settle path (watchdog / poller) when SportMonks
-- reports the match finished. Its existence is also the "predictions closed"
-- signal: once a result row exists, POST /api/halftime/predict refuses new picks.

create table if not exists halftime_prediction_results (
  fixture_id bigint primary key,
  home_goals int  not null,
  away_goals int  not null,
  result     text not null check (result in ('home', 'draw', 'away')),
  settled_at timestamptz not null default now()
);

-- 3. RLS — deny-all, exactly like halftime_releases ----------------------------
-- Enable RLS and create NO anon/authenticated policies. service_role has
-- BYPASSRLS and keeps its default table grants, so the API routes (which insert a
-- fan's own pick after authenticating them, and read every pick to build the
-- tally) work; a direct client read/write does not. This is the same posture the
-- halftime pipeline uses everywhere: public access goes through a route that
-- serves a deliberate projection, never the raw table.

alter table halftime_predictions        enable row level security;
alter table halftime_prediction_results enable row level security;

commit;

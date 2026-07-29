-- 210: Fantasy Assistant forward-collection snapshot tables.
--
-- Purpose: deadline-correct, IMMUTABLE snapshots of everything the captaincy
-- assistant needs to be evaluated honestly — FPL projections/injuries/prices and
-- SportMonks pre-match odds — captured BEFORE each deadline, plus a run-history
-- table so a silently dead collector is detectable.
--
-- Why in Postgres rather than local files: the product API and the shadow
-- evaluator both need queryable snapshots, and collection must not depend on a
-- laptop being awake.
--
-- Additive only. No existing table is modified.
--
-- Immutability is ENFORCED, not just intended: an UPDATE or DELETE on a snapshot
-- row raises. A pre-deadline price/odd that can be edited after the fact is
-- worthless as evidence.
--
-- RLS is enabled with NO policies => deny-all for anon/authenticated.
-- service_role bypasses RLS and is what the collector uses.

create table if not exists public.fantasy_fpl_snapshot (
  id                            bigserial primary key,
  captured_at                   timestamptz not null,
  current_event                 int,
  next_event                    int,
  next_deadline                 timestamptz,
  player_id                     int  not null,          -- FPL element id (= YourScore pool id)
  web_name                      text,
  team                          int,
  position                      text,
  now_cost                      int,                    -- price in tenths
  selected_by_percent           numeric,
  ep_this                       numeric,
  ep_next                       numeric,
  form                          numeric,
  status                        text,
  news                          text,
  chance_of_playing_this_round  int,
  chance_of_playing_next_round  int,
  transfers_in_event            bigint,
  transfers_out_event           bigint,
  constraint fantasy_fpl_snapshot_uniq unique (captured_at, player_id)
);

create index if not exists fantasy_fpl_snapshot_captured_idx on public.fantasy_fpl_snapshot (captured_at desc);
create index if not exists fantasy_fpl_snapshot_player_idx   on public.fantasy_fpl_snapshot (player_id, captured_at desc);
create index if not exists fantasy_fpl_snapshot_event_idx    on public.fantasy_fpl_snapshot (next_event);

create table if not exists public.fantasy_odds_snapshot (
  id                    bigserial primary key,
  collected_at          timestamptz not null,
  fixture_id            bigint not null,
  fixture_kickoff       timestamptz,
  market_id             int,
  market_description    text,
  bookmaker_id          int,
  selection             text,
  handicap              text,
  odds                  numeric,
  odds_probability_raw  numeric,   -- 1/decimal, BEFORE margin removal
  source_updated_at     timestamptz
);

create unique index if not exists fantasy_odds_snapshot_uniq
  on public.fantasy_odds_snapshot (collected_at, fixture_id, market_id, bookmaker_id, selection, coalesce(handicap, ''));
create index if not exists fantasy_odds_snapshot_fixture_idx on public.fantasy_odds_snapshot (fixture_id, collected_at desc);
create index if not exists fantasy_odds_snapshot_collected_idx on public.fantasy_odds_snapshot (collected_at desc);

-- run history: the alerting surface. A row per collector tick, including skips.
create table if not exists public.fantasy_collection_run (
  id                  bigserial primary key,
  started_at          timestamptz not null,
  finished_at         timestamptz,
  band                text,          -- daily | 6-hourly | hourly | final-15m | post-deadline
  hours_to_deadline   numeric,
  collected           boolean not null default false,
  post_deadline       boolean not null default false,
  ok                  boolean not null default false,
  fpl_rows            int,
  odds_rows           int,
  error               text
);

create index if not exists fantasy_collection_run_started_idx on public.fantasy_collection_run (started_at desc);

-- append-only enforcement
create or replace function public.fantasy_snapshot_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'fantasy snapshot tables are append-only: % on % is not permitted',
    tg_op, tg_table_name;
end;
$$;

drop trigger if exists fantasy_fpl_snapshot_append_only on public.fantasy_fpl_snapshot;
create trigger fantasy_fpl_snapshot_append_only
  before update or delete on public.fantasy_fpl_snapshot
  for each row execute function public.fantasy_snapshot_append_only();

drop trigger if exists fantasy_odds_snapshot_append_only on public.fantasy_odds_snapshot;
create trigger fantasy_odds_snapshot_append_only
  before update or delete on public.fantasy_odds_snapshot
  for each row execute function public.fantasy_snapshot_append_only();

alter table public.fantasy_fpl_snapshot   enable row level security;
alter table public.fantasy_odds_snapshot  enable row level security;
alter table public.fantasy_collection_run enable row level security;

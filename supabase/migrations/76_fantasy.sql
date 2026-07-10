-- 76_fantasy.sql — YourScore Fantasy Football Phase 1 (persistent squads,
-- weekly knowledge round → transfer credits, gameweek scoring).
-- RLS posture (per 61_group_challenges precedent): owner/public SELECT only;
-- ALL writes go through service-role API routes — no client write policies.
begin;

-- The gameweek calendar (replay + live share one shape)
create table if not exists fantasy_gameweeks (
  gw            int primary key,
  season        text not null,                 -- '2025/26' replay | '2026/27' live
  mode          text not null default 'replay',-- 'replay' | 'live'
  window_start  date not null,                 -- SM fixtures/between window
  window_end    date not null,
  deadline      timestamptz,                   -- live: first kickoff − 90m; replay: null
  status        text not null default 'open',  -- open | locked | scored | final
  sm_season_id  int not null
);
alter table fantasy_gameweeks enable row level security;
drop policy if exists "fantasy_gameweeks_read" on fantasy_gameweeks;
create policy "fantasy_gameweeks_read" on fantasy_gameweeks for select to public using (true);

-- One row per user: the persistent squad + all durable state
create table if not exists fantasy_squads (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  picks      jsonb not null,                -- 15 × {id, pos, clubId, buyTenths}
  bank_tenths int not null,                 -- picks Σ + bank = 1000 invariant
  credits    int not null default 0,        -- transfer-credit bank (cap 5)
  xi         int[] not null,
  bench      int[] not null,                -- bench[1] = reserve GK
  captain    int not null,
  vice       int not null,
  version    int not null default 0,        -- optimistic lock for transfer races
  created_gw int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table fantasy_squads enable row level security;
drop policy if exists "fantasy_squads_own_read" on fantasy_squads;
create policy "fantasy_squads_own_read" on fantasy_squads for select using (auth.uid() = user_id);

-- One row per (user, gw): round + transfers + locked snapshot + result
create table if not exists fantasy_entries (
  user_id       uuid not null references auth.users(id) on delete cascade,
  gw            int not null references fantasy_gameweeks(gw),
  status        text not null default 'open', -- open | locked | scored | final
  round_version text,
  round_answers jsonb not null default '[]',
  round_correct int not null default 0,
  round_credits int not null default 0,
  round_done_at timestamptz,
  transfers     jsonb not null default '[]',  -- [{out,in,outTenths,inTenths,paid}]
  hits          int not null default 0,
  picks jsonb, xi int[], bench int[], captain int, vice int,
  locked_at     timestamptz,
  points int, points_breakdown jsonb, autosubs jsonb, captain_used int,
  scored_at     timestamptz,
  primary key (user_id, gw)
);
create index if not exists fantasy_entries_gw_idx on fantasy_entries (gw, status);
alter table fantasy_entries enable row level security;
drop policy if exists "fantasy_entries_own_read" on fantasy_entries;
create policy "fantasy_entries_own_read" on fantasy_entries for select using (auth.uid() = user_id);

-- Per-GW per-player facts + points from ingest (public data)
create table if not exists fantasy_player_scores (
  gw         int not null,
  player_id  int not null,      -- pool id (= FPL element id)
  minutes    int not null default 0,
  facts      jsonb not null,
  points     int not null,
  updated_at timestamptz not null default now(),
  primary key (gw, player_id)
);
alter table fantasy_player_scores enable row level security;
drop policy if exists "fantasy_player_scores_read" on fantasy_player_scores;
create policy "fantasy_player_scores_read" on fantasy_player_scores for select to public using (true);

commit;

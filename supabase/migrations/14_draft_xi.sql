-- 14_draft_xi.sql
-- Draft XI — competitive H2H football team-builder game. ADDITIVE ONLY: no
-- existing YourScore table, policy, or function is touched. Apply when ready to
-- ship the account-backed features (save team, real matchmaking, leaderboards).
-- Until applied, the game is fully playable anonymously (client + localStorage);
-- these tables back cloud save, H2H matchmaking, and leaderboards.
--
-- Server stays authoritative: the API recomputes strength_rating + projected from
-- `squad` on every save/match via lib/draft/score.ts and ignores client values.

begin;

-- A player's current active XI ------------------------------------------------
create table if not exists draft_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  display_name text,
  formation text not null,                 -- '4-3-3' etc
  squad jsonb not null,                     -- PlacedPlayer[]
  strength_rating numeric not null,
  projected jsonb not null,                 -- {wins,draws,losses,points,position,tier}
  status text not null default 'active',    -- 'active' | 'stale'
  win_streak int not null default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table draft_teams enable row level security;
drop policy if exists "draft_teams owner rw" on draft_teams;
create policy "draft_teams owner rw" on draft_teams
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Only active teams are publicly visible (for matchmaking / opponent display).
drop policy if exists "draft_teams public read active" on draft_teams;
create policy "draft_teams public read active" on draft_teams
  for select using (status = 'active');
create unique index if not exists draft_teams_user_uidx on draft_teams (user_id);
create index if not exists draft_teams_active_idx on draft_teams (status) where status = 'active';

-- Every H2H result (snapshot both XIs so later edits can't rewrite history) ----
create table if not exists draft_matches (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid references auth.users(id) on delete cascade,
  opponent_id uuid references auth.users(id) on delete cascade,
  challenger_team jsonb not null,
  opponent_team jsonb not null,
  challenger_strength numeric not null,
  opponent_strength numeric not null,
  winner_id uuid not null,
  league_id uuid,                          -- null for global/random
  played_at timestamptz default now()
);
alter table draft_matches enable row level security;
drop policy if exists "draft_matches participants read" on draft_matches;
create policy "draft_matches participants read" on draft_matches
  for select using (auth.uid() = challenger_id or auth.uid() = opponent_id);
-- Result pages are shareable, so a match is publicly readable by id (the OG image
-- and /draft/match/[id] need it). Tighten to a token if this proves too open.
drop policy if exists "draft_matches public read" on draft_matches;
create policy "draft_matches public read" on draft_matches for select using (true);
create index if not exists draft_matches_challenger_idx on draft_matches (challenger_id, played_at desc);
create index if not exists draft_matches_league_idx on draft_matches (league_id, played_at desc);

-- Win tallies (denormalised for fast leaderboards) ----------------------------
-- league_id is part of the primary key, so it cannot be NULL. The all-zeros
-- sentinel uuid means "global" (no real league will ever use that id).
create table if not exists draft_standings (
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null,
  league_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  wins_today int not null default 0,
  wins_all_time int not null default 0,
  last_win_date date,
  updated_at timestamptz default now(),
  primary key (user_id, league_id)
);
alter table draft_standings enable row level security;
drop policy if exists "draft_standings anyone read" on draft_standings;
create policy "draft_standings anyone read" on draft_standings for select using (true);
drop policy if exists "draft_standings owner upsert" on draft_standings;
create policy "draft_standings owner upsert" on draft_standings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- league_id is part of the PK; coalesce NULL -> all-zeros so the global row (null
-- league) and per-league rows both index cleanly for "top N by wins".
create index if not exists draft_standings_daily_idx on draft_standings (league_id, wins_today desc);
create index if not exists draft_standings_alltime_idx on draft_standings (league_id, wins_all_time desc);

-- Custom (private) leagues ----------------------------------------------------
create table if not exists draft_leagues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  join_code text unique not null,
  created_at timestamptz default now()
);
create table if not exists draft_league_members (
  league_id uuid references draft_leagues(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (league_id, user_id)
);
alter table draft_leagues enable row level security;
alter table draft_league_members enable row level security;
-- Members (and the owner) can read a league; anyone can resolve a league by its
-- join_code to join (enforced in the API, which looks up by code).
drop policy if exists "draft_leagues members read" on draft_leagues;
create policy "draft_leagues members read" on draft_leagues
  for select using (
    auth.uid() = owner_id or exists (
      select 1 from draft_league_members m
      where m.league_id = id and m.user_id = auth.uid()
    )
  );
drop policy if exists "draft_leagues owner manage" on draft_leagues;
create policy "draft_leagues owner manage" on draft_leagues
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "draft_league_members member rw" on draft_league_members;
create policy "draft_league_members member rw" on draft_league_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Daily reset: zero wins_today for rows whose last win was before today (UTC).
-- Call from a scheduled job (pg_cron / the existing /api/cron pattern) at 00:00 UTC.
create or replace function draft_reset_daily()
returns void
language sql
as $$
  update draft_standings
     set wins_today = 0, updated_at = now()
   where wins_today <> 0
     and (last_win_date is null or last_win_date < current_date);
$$;

-- Leaderboard read: top N by daily or all-time wins for a league. Pass the
-- all-zeros sentinel (or NULL, which is coalesced to it) for the global board.
create or replace function draft_leaderboard(p_league_id uuid, p_metric text, p_limit int default 50)
returns table (user_id uuid, display_name text, wins_today int, wins_all_time int, rank bigint)
language sql
stable
as $$
  select s.user_id, s.display_name, s.wins_today, s.wins_all_time,
         row_number() over (
           order by case when p_metric = 'today' then s.wins_today else s.wins_all_time end desc
         ) as rank
  from draft_standings s
  where s.league_id = coalesce(p_league_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (case when p_metric = 'today' then s.wins_today else s.wins_all_time end) > 0
  order by case when p_metric = 'today' then s.wins_today else s.wins_all_time end desc
  limit p_limit;
$$;

commit;

-- 23_draft_competition.sql
-- 38-0 — multi-competition (Premier League + La Liga).
--
-- ADDITIVE. Adds a `competition` dimension ('PL' | 'LaLiga') to every 38-0 table so
-- the two leagues are self-contained: one active team per competition, separate
-- leaderboards, and Live H2H matched within a competition. Every column defaults to
-- 'PL', so existing rows and the existing PL flow are unchanged. Idempotent.
--
-- Server stays authoritative: the competition is taken from the saved team / match
-- context, never trusted blind from the client for crediting.

begin;

-- 1. Tag teams, saved teams, matches, standings and the live working-state rows ---
alter table draft_teams        add column if not exists competition text not null default 'PL';
alter table draft_saved_teams  add column if not exists competition text not null default 'PL';
alter table draft_matches      add column if not exists competition text not null default 'PL';
alter table draft_standings    add column if not exists competition text not null default 'PL';
alter table draft_live_matches add column if not exists competition text not null default 'PL';
alter table draft_live_queue   add column if not exists competition text not null default 'PL';
alter table draft_challenges   add column if not exists competition text not null default 'PL';

-- 2. One active team PER COMPETITION (was: one per user) -------------------------
drop index if exists draft_teams_user_uidx;
create unique index if not exists draft_teams_user_comp_uidx on draft_teams (user_id, competition);

-- 3. Standings are keyed by competition too. Extend the PK (user_id, league_id) to
--    include competition so a user's PL and La Liga rows for the same league never
--    collide. Existing rows default to 'PL', so the new PK stays unique.
alter table draft_standings drop constraint if exists draft_standings_pkey;
alter table draft_standings add primary key (user_id, league_id, competition);
create index if not exists draft_standings_comp_daily_idx   on draft_standings (competition, league_id, wins_today desc);
create index if not exists draft_standings_comp_alltime_idx on draft_standings (competition, league_id, wins_all_time desc);

create index if not exists draft_matches_comp_idx on draft_matches (competition, played_at desc);

-- 4. Crediting becomes competition-aware. Drop the old 4-arg signature first so the
--    new 5-arg form (with a defaulted p_competition) isn't an ambiguous overload.
drop function if exists draft_credit_result(uuid, text, text, uuid);
create or replace function draft_credit_result(
  p_user uuid,
  p_name text,
  p_result text,                 -- 'win' | 'draw' | 'loss'
  p_league uuid default '00000000-0000-0000-0000-000000000000'::uuid,
  p_competition text default 'PL'
)
returns void
language plpgsql
as $$
declare
  v_league uuid := coalesce(p_league, '00000000-0000-0000-0000-000000000000'::uuid);
  v_comp text := coalesce(p_competition, 'PL');
  v_w int := (p_result = 'win')::int;
  v_d int := (p_result = 'draw')::int;
  v_l int := (p_result = 'loss')::int;
begin
  insert into draft_standings as s (
    user_id, display_name, league_id, competition,
    wins_today, draws_today, losses_today,
    wins_all_time, draws_all_time, losses_all_time,
    last_played_date, last_win_date, updated_at
  )
  values (
    p_user, p_name, v_league, v_comp,
    v_w, v_d, v_l,
    v_w, v_d, v_l,
    current_date, case when p_result = 'win' then current_date else null end, now()
  )
  on conflict (user_id, league_id, competition) do update set
    display_name    = excluded.display_name,
    wins_today      = (case when s.last_played_date = current_date then s.wins_today   else 0 end) + v_w,
    draws_today     = (case when s.last_played_date = current_date then s.draws_today  else 0 end) + v_d,
    losses_today    = (case when s.last_played_date = current_date then s.losses_today else 0 end) + v_l,
    wins_all_time   = s.wins_all_time   + v_w,
    draws_all_time  = s.draws_all_time  + v_d,
    losses_all_time = s.losses_all_time + v_l,
    last_played_date = current_date,
    last_win_date   = case when p_result = 'win' then current_date else s.last_win_date end,
    updated_at      = now();
end;
$$;

-- 5. Points leaderboard, scoped to a competition (defaults to PL) ----------------
drop function if exists draft_leaderboard_points(uuid, text, int);
create or replace function draft_leaderboard_points(
  p_league_id uuid,
  p_metric text,
  p_limit int default 50,
  p_competition text default 'PL'
)
returns table (user_id uuid, display_name text, wins int, draws int, losses int, points int, rank bigint)
language sql
stable
as $$
  with rows as (
    select s.user_id, s.display_name,
           case when p_metric = 'today' then s.wins_today   else s.wins_all_time   end as wins,
           case when p_metric = 'today' then s.draws_today  else s.draws_all_time  end as draws,
           case when p_metric = 'today' then s.losses_today else s.losses_all_time end as losses
      from draft_standings s
     where s.league_id = coalesce(p_league_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and s.competition = coalesce(p_competition, 'PL')
  )
  select user_id, display_name, wins, draws, losses,
         (wins * 3 + draws) as points,
         row_number() over (order by (wins * 3 + draws) desc, wins desc) as rank
    from rows
   where (wins * 3 + draws) > 0
   order by points desc, wins desc
   limit p_limit;
$$;

-- 6. Matchmaking pairs within the same competition (and ranked flag + league) -----
drop function if exists draft_live_pair(uuid, boolean, uuid);
create or replace function draft_live_pair(
  p_user uuid,
  p_ranked boolean,
  p_league uuid,
  p_competition text default 'PL'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_match uuid;
  v_comp text := coalesce(p_competition, 'PL');
begin
  select user_id into v_match
    from draft_live_queue
   where user_id <> p_user
     and ranked = p_ranked
     and league_id is not distinct from p_league
     and competition = v_comp
   order by enqueued_at
   for update skip locked
   limit 1;

  if v_match is not null then
    delete from draft_live_queue where user_id in (v_match, p_user);
    return v_match;
  end if;

  insert into draft_live_queue (user_id, ranked, league_id, competition)
  values (p_user, p_ranked, p_league, v_comp)
  on conflict (user_id) do update
    set enqueued_at = now(), ranked = excluded.ranked, league_id = excluded.league_id, competition = excluded.competition;
  return null;
end;
$$;

commit;

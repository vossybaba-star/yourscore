-- 10_league_standings_rpcs.sql
-- Collapse the league N+1 query patterns (1 + 2N round-trips on the dashboard and
-- the leagues list) into single round-trips via set-returning functions.

begin;

-- For the leagues LIST: one row per league the user belongs to, with the league's
-- member count, the user's score, and the user's rank. Replaces the per-league
-- pair of count() queries in src/app/leagues/page.tsx.
create or replace function get_my_leagues(p_user_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  code text,
  member_count bigint,
  my_score integer,
  my_rank bigint
)
language sql
stable
as $$
  with my as (
    select lm.league_id, coalesce(lm.total_score, 0) as total_score
    from league_members lm
    where lm.user_id = p_user_id
  )
  select
    l.id,
    l.name,
    l.description,
    l.code,
    (select count(*) from league_members x where x.league_id = l.id) as member_count,
    my.total_score as my_score,
    (select count(*) from league_members x
       where x.league_id = l.id and coalesce(x.total_score, 0) > my.total_score) + 1 as my_rank
  from my
  join leagues l on l.id = my.league_id
  order by my.total_score desc;
$$;

-- For the dashboard STANDINGS tile: the top N members (with display names) for each
-- league the user belongs to, in one query. Replaces the per-league memberRows +
-- profiles fetch in src/app/page.tsx (LeagueStandingsTile).
create or replace function get_my_league_standings(p_user_id uuid, p_limit int default 20)
returns table (
  league_id uuid,
  league_name text,
  user_id uuid,
  display_name text,
  total_score integer
)
language sql
stable
as $$
  with my_leagues as (
    select league_id from league_members where user_id = p_user_id limit 10
  ),
  ranked as (
    select
      lm.league_id,
      l.name as league_name,
      lm.user_id,
      p.display_name,
      coalesce(lm.total_score, 0) as total_score,
      row_number() over (
        partition by lm.league_id order by coalesce(lm.total_score, 0) desc
      ) as rn
    from league_members lm
    join my_leagues ml on ml.league_id = lm.league_id
    join leagues l on l.id = lm.league_id
    left join profiles p on p.id = lm.user_id
  )
  select league_id, league_name, user_id, display_name, total_score
  from ranked
  where rn <= p_limit
  order by league_name, total_score desc;
$$;

commit;

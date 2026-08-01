-- 235_standings_include_all_squads.sql
-- Populate the league tables before a ball is kicked. The standings RPC used to
-- read ONLY scored fantasy_entries, so pre-season (no gameweek played) the table
-- was empty — a dead screen on the tab we just made the hero of the app.
--
-- Now the roster is EVERY manager who has signed up (built a squad in
-- fantasy_squads), seeds included, with points LEFT-JOINed in and defaulting to 0.
-- So the table shows the whole field at 0 until GW1 scores, then fills naturally
-- (founder, 1 Aug: "add them all in with zero values because no games have been
-- played yet"). This reverses mig 230's seed exclusion for the DISPLAY table;
-- prize eligibility, when it's built, filters seeds separately at award time.
--
-- Ranking: points, then knowledge, then last gameweek, then signup time, then id —
-- the last two keep ranks distinct and stable when everyone is level on zero, so
-- row_number() gives a clean 1..N instead of everyone tied at 1.
--
-- fantasy_rank_jumps is left alone: it drives the feed's "climbed N places"
-- events, where we still don't want fake accounts generating noise.

create or replace function public.fantasy_global_standings(
  p_gws    int[],
  p_viewer uuid,
  p_limit  int default 50
)
returns table (
  rank           bigint,
  user_id        uuid,
  points         bigint,
  played         bigint,
  knowledge      bigint,
  last_gw_points bigint,
  is_viewer      boolean,
  total_players  bigint
)
language sql
stable
as $$
  with managers as (
    -- Everyone signed up for fantasy = everyone with a squad. Seeds included so
    -- the table looks alive pre-season.
    select s.user_id, s.created_at
    from public.fantasy_squads s
  ),
  scored as (
    select
      e.user_id,
      sum(e.points)::bigint                                as points,
      count(*)::bigint                                     as played,
      sum(coalesce(e.round_correct, 0))::bigint            as knowledge,
      (array_agg(e.points order by e.gw desc))[1]::bigint  as last_gw_points
    from public.fantasy_entries e
    where e.gw = any(p_gws) and e.points is not null
    group by e.user_id
  ),
  totals as (
    select
      m.user_id,
      coalesce(sc.points, 0)::bigint    as points,
      coalesce(sc.played, 0)::bigint    as played,
      coalesce(sc.knowledge, 0)::bigint as knowledge,
      sc.last_gw_points,
      m.created_at
    from managers m
    left join scored sc on sc.user_id = m.user_id
  ),
  ranked as (
    select
      t.user_id, t.points, t.played, t.knowledge, t.last_gw_points,
      row_number() over (
        order by t.points desc, t.knowledge desc, t.last_gw_points desc nulls last,
                 t.created_at asc, t.user_id
      ) as rank
    from totals t
  ),
  counted as (select count(*)::bigint as n from ranked)
  select
    r.rank, r.user_id, r.points, r.played, r.knowledge, r.last_gw_points,
    (r.user_id = p_viewer) as is_viewer,
    c.n as total_players
  from ranked r cross join counted c
  where r.rank <= p_limit or r.user_id = p_viewer
  order by r.rank;
$$;

revoke execute on function public.fantasy_global_standings(int[], uuid, int) from public;
grant  execute on function public.fantasy_global_standings(int[], uuid, int) to service_role;

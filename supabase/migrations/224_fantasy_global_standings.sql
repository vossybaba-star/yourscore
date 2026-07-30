-- 224_fantasy_global_standings.sql
-- Global fantasy standings — rank EVERY fantasy player by points over a set of
-- gameweeks: the current month's gws (the headline monthly comp), the whole
-- season, or a single gameweek. Returns the top N PLUS the viewer's own row, so
-- "where do I fall" resolves even for someone ranked 8,000th.
--
-- The aggregation lives in SQL because the pool is tens of thousands of players —
-- well past PostgREST's 1000-row read cap, and not something to pull client-side.
--
-- Ranking mirrors the per-league table (leagues.ts buildRows): points desc, then
-- knowledge (round_correct) desc, then the most recent gameweek's points. Called
-- only by the service role via /api/fantasy/standings (which supplies the
-- authenticated viewer) — no anon/authenticated execute.

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
  with totals as (
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
  ranked as (
    select
      t.user_id, t.points, t.played, t.knowledge, t.last_gw_points,
      rank() over (
        order by t.points desc, t.knowledge desc, t.last_gw_points desc nulls last
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

-- EXECUTE is granted to PUBLIC by default, so the revoke has to name public.
revoke execute on function public.fantasy_global_standings(int[], uuid, int) from public;
grant  execute on function public.fantasy_global_standings(int[], uuid, int) to service_role;

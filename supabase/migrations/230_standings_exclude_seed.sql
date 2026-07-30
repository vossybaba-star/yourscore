-- 230_standings_exclude_seed.sql
-- Keep seed accounts OUT of the competitive tables. Seeds (mig 229 is_seed) exist
-- to fill the follow graph, the discover list, and the activity feed — not to
-- compete. Their squads would otherwise score naturally at GW1 and rank among
-- real managers, which is exactly the "real user loses a place to a fake" case
-- the guardrail forbids.
--
-- So both ranking RPCs now inner-join profiles and drop is_seed users:
--   - fantasy_global_standings (the league-tab table + your rank)
--   - fantasy_rank_jumps (the feed's "climbed N places" events)
-- The feed's transfer/chip/haul events are untouched — seeds stay social, just
-- not ranked. Prizes read the standings, so this covers prize exclusion too.

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
    join public.profiles pr on pr.id = e.user_id and pr.is_seed = false
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

create or replace function public.fantasy_rank_jumps(
  p_gw       int,
  p_min_jump int
)
returns table (
  user_id    uuid,
  jump       bigint,
  after_rank bigint
)
language sql
stable
as $$
  with after_pts as (
    select e.user_id, sum(e.points)::bigint as pts
    from public.fantasy_entries e
    join public.profiles pr on pr.id = e.user_id and pr.is_seed = false
    where e.gw <= p_gw and e.points is not null
    group by e.user_id
  ),
  before_pts as (
    select e.user_id, sum(e.points)::bigint as pts
    from public.fantasy_entries e
    join public.profiles pr on pr.id = e.user_id and pr.is_seed = false
    where e.gw <= p_gw - 1 and e.points is not null
    group by e.user_id
  ),
  ranked_after as (select user_id, rank() over (order by pts desc) as r from after_pts),
  ranked_before as (select user_id, rank() over (order by pts desc) as r from before_pts)
  select a.user_id, (b.r - a.r) as jump, a.r as after_rank
  from ranked_after a
  join ranked_before b on b.user_id = a.user_id
  where (b.r - a.r) >= p_min_jump
  order by jump desc;
$$;

revoke execute on function public.fantasy_global_standings(int[], uuid, int) from public;
grant  execute on function public.fantasy_global_standings(int[], uuid, int) to service_role;
revoke execute on function public.fantasy_rank_jumps(int, int) from public;
grant  execute on function public.fantasy_rank_jumps(int, int) to service_role;

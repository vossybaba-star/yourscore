-- 227_fantasy_rank_jumps.sql
-- Who climbed the global table this gameweek — the data behind "X climbed N
-- places" feed events. Compares each manager's global rank on cumulative points
-- THROUGH this gameweek vs THROUGH the previous one, and returns only the real
-- climbers (jump >= p_min_jump). SQL because the pool is tens of thousands, and
-- returning only the climbers keeps the result set tiny.
--
-- INNER join on the prior standing: a genuine climb needs a prior rank, so a
-- brand-new manager (no entry before this gw) is not a "climber" and is excluded.
-- Naturally returns nothing at GW1 (no previous gameweek). Service role only.

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
    select user_id, sum(points)::bigint as pts
    from public.fantasy_entries
    where gw <= p_gw and points is not null
    group by user_id
  ),
  before_pts as (
    select user_id, sum(points)::bigint as pts
    from public.fantasy_entries
    where gw <= p_gw - 1 and points is not null
    group by user_id
  ),
  ranked_after as (
    select user_id, rank() over (order by pts desc) as r from after_pts
  ),
  ranked_before as (
    select user_id, rank() over (order by pts desc) as r from before_pts
  )
  select
    a.user_id,
    (b.r - a.r) as jump,
    a.r         as after_rank
  from ranked_after a
  join ranked_before b on b.user_id = a.user_id
  where (b.r - a.r) >= p_min_jump
  order by jump desc;
$$;

revoke execute on function public.fantasy_rank_jumps(int, int) from public;
grant  execute on function public.fantasy_rank_jumps(int, int) to service_role;

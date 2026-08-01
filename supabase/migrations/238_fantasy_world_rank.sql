-- A global "where am I in the world" rank for fantasy, for the profile page.
--
-- Nothing ranked all managers by fantasy points before this — ranking only
-- existed inside a mini-league, and the one global board (knowledge) ranks quiz
-- accuracy, not points. This is the season-points world ladder.
--
-- Honest about pre-season: a manager is ranked only once they have SCORED points
-- (fantasy_entries.points is null until a gameweek is graded). Before GW1 nobody
-- is scored, so world_rank comes back null and the UI shows "Unranked — season
-- starts 21 Aug" rather than a fake #1-of-everyone. `total_managers` is the size
-- of the world (anyone who has built a squad), so the profile can still say how
-- big the field is while you wait.

create or replace function get_fantasy_world_rank(p_user_id uuid)
returns table (
  total_points bigint,
  world_rank int,
  total_managers int,
  ranked_managers int
)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    -- One row per manager who has any graded gameweek, with their season total.
    select user_id, sum(points)::bigint as pts
    from fantasy_entries
    where points is not null
    group by user_id
  ),
  me as (
    select pts from totals where user_id = p_user_id
  )
  select
    coalesce((select pts from me), 0)::bigint,
    -- Standard competition rank: how many managers sit strictly above you, +1.
    -- Null when you have no scored points yet (you're not on the ladder).
    case when exists (select 1 from me)
      then (select count(*) + 1 from totals t where t.pts > (select pts from me))::int
      else null
    end,
    (select count(*) from fantasy_squads)::int,
    (select count(*) from totals)::int;
$$;

grant execute on function get_fantasy_world_rank(uuid) to anon, authenticated;

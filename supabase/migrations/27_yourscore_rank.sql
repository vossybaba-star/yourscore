-- 26_yourscore_rank.sql
-- Unified "YourScore Rank": ONE headline rank that blends two VISIBLE tracks —
--   • Match track     = 38-0 ranked results  (draft_standings global/zero-uuid row)
--   • Knowledge track = quiz + solo          (profiles.total_score + challenge_attempts)
-- This is the 38-0 -> quiz bridge: a 38-0 player must also play quizzes to climb.
--
-- Read-time aggregation ONLY. No existing write path changes; both tracks already
-- populate their own tables. Each track is percentile-normalized (so their very
-- different point scales blend fairly), then blended 50/50 into an overall 0-1000.
-- The 50/50 weight is the one tuning dial — change the literals in the view to retune.
-- Idempotent (re-runnable): drops + recreates the view and functions.

-- ── Tier mapping (overall is percentile*1000) ──────────────────────────────────
create or replace function yourscore_tier(p_overall int)
returns text language sql immutable as $$
  select case
    when p_overall >= 950 then 'Elite'
    when p_overall >= 800 then 'Diamond'
    when p_overall >= 600 then 'Platinum'
    when p_overall >= 400 then 'Gold'
    when p_overall >= 200 then 'Silver'
    else 'Bronze'
  end;
$$;

-- ── Per-user ratings (full population; window fns compute percentile + rank) ────
drop view if exists yourscore_user_ratings cascade;
create view yourscore_user_ratings as
with base as (
  select
    p.id                                            as user_id,
    coalesce(nullif(p.display_name, ''), 'Player')  as display_name,
    p.avatar_url                                    as avatar_url,
    -- Knowledge: global quiz points (multiplayer + live) + solo challenge points
    (coalesce(p.total_score, 0) + coalesce(sc.solo_score, 0)) as knowledge_score,
    -- Match: 38-0 GLOBAL ranked record (zero-uuid league row); points = 3*W + D
    (coalesce(ds.wins_all_time, 0) * 3 + coalesce(ds.draws_all_time, 0)) as match_score,
    coalesce(ds.wins_all_time, 0)   as wins,
    coalesce(ds.draws_all_time, 0)  as draws,
    coalesce(ds.losses_all_time, 0) as losses
  from profiles p
  left join (
    select user_id, sum(coalesce(score, 0)) as solo_score
    from challenge_attempts
    group by user_id
  ) sc on sc.user_id = p.id
  left join draft_standings ds
    on ds.user_id = p.id
   and ds.league_id = '00000000-0000-0000-0000-000000000000'::uuid
),
ranked as (
  select b.*,
    percent_rank() over (order by knowledge_score) as knowledge_pct,
    percent_rank() over (order by match_score)     as match_pct
  from base b
),
blended as (
  select r.*,
    round(1000 * (0.5 * r.match_pct + 0.5 * r.knowledge_pct))::int as overall_score
  from ranked r
)
select bl.*,
  dense_rank() over (order by bl.overall_score desc)::int as overall_rank
from blended bl;

-- ── One user's rank card ───────────────────────────────────────────────────────
create or replace function get_yourscore_rank(p_user_id uuid)
returns table (
  user_id uuid, display_name text, avatar_url text,
  match_score int, knowledge_score int,
  match_pct numeric, knowledge_pct numeric,
  overall_score int, overall_rank int, tier text,
  wins int, draws int, losses int
) language sql stable security definer set search_path = public as $$
  select r.user_id, r.display_name, r.avatar_url,
    r.match_score, r.knowledge_score,
    round(r.match_pct::numeric, 4), round(r.knowledge_pct::numeric, 4),
    r.overall_score, r.overall_rank, yourscore_tier(r.overall_score),
    r.wins, r.draws, r.losses
  from yourscore_user_ratings r
  where r.user_id = p_user_id;
$$;

-- ── Leaderboard: global (p_user_ids null) OR scoped to a set (friends + self) ──
create or replace function get_yourscore_leaderboard(p_user_ids uuid[] default null, p_limit int default 50)
returns table (
  user_id uuid, display_name text, avatar_url text,
  match_score int, knowledge_score int,
  overall_score int, overall_rank int, tier text,
  wins int, draws int, losses int
) language sql stable security definer set search_path = public as $$
  select r.user_id, r.display_name, r.avatar_url,
    r.match_score, r.knowledge_score,
    r.overall_score, r.overall_rank, yourscore_tier(r.overall_score),
    r.wins, r.draws, r.losses
  from yourscore_user_ratings r
  where p_user_ids is null or r.user_id = any(p_user_ids)
  order by r.overall_rank asc, r.display_name asc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function yourscore_tier(int)                     to anon, authenticated;
grant execute on function get_yourscore_rank(uuid)                to anon, authenticated;
grant execute on function get_yourscore_leaderboard(uuid[], int)  to anon, authenticated;

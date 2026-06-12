-- 30_yourscore_points.sql
-- YourScore Rank v2 — ONE currency, ONE leaderboard, strict positions.
--
-- v1 (migration 27) blended per-track percentiles into a 0-1000 score with tiers.
-- Founder direction: users think "more points -> higher position", no percentages,
-- position over tiers, and never two players sharing a position. So:
--
--   YourScore = Knowledge points (quiz multiplayer/live + solo, as-is)
--             + Match points     (38-0 ranked record: WIN = 1500, DRAW = 500)
--
-- The 1500/500 exchange rate keeps football's 3:1 win:draw ratio and makes one
-- win worth roughly one strong quiz session — the single tuning dial, change it
-- here only. Positions are unique: ties broken by who got there first (earlier
-- account), then user_id for full determinism. Tier badges are now cosmetic and
-- live in the client (src/lib/rank.ts) — derived from position, not points.
--
-- Idempotent; replaces the v1 view + RPCs (return shapes change, so drop first).

drop view if exists yourscore_user_ratings cascade;
drop function if exists get_yourscore_rank(uuid);
drop function if exists get_yourscore_leaderboard(uuid[], int);
drop function if exists yourscore_tier(int);

create view yourscore_user_ratings as
select
  b.*,
  (b.knowledge_score + b.match_score)::int as overall_score,
  row_number() over (
    order by (b.knowledge_score + b.match_score) desc, b.created_at asc, b.user_id asc
  )::int as overall_rank
from (
  select
    p.id                                            as user_id,
    coalesce(nullif(p.display_name, ''), 'Player')  as display_name,
    p.avatar_url                                    as avatar_url,
    (coalesce(p.total_score, 0) + coalesce(sc.solo_score, 0))::int as knowledge_score,
    (coalesce(ds.wins_all_time, 0) * 1500 + coalesce(ds.draws_all_time, 0) * 500)::int as match_score,
    coalesce(ds.wins_all_time, 0)   as wins,
    coalesce(ds.draws_all_time, 0)  as draws,
    coalesce(ds.losses_all_time, 0) as losses,
    p.created_at                                    as created_at
  from profiles p
  left join (
    select user_id, sum(coalesce(score, 0)) as solo_score
    from challenge_attempts
    group by user_id
  ) sc on sc.user_id = p.id
  left join draft_standings ds
    on ds.user_id = p.id
   and ds.league_id = '00000000-0000-0000-0000-000000000000'::uuid
) b;

-- One user's rank card, incl. the player directly above (powers "overtake X").
create or replace function get_yourscore_rank(p_user_id uuid)
returns table (
  user_id uuid, display_name text, avatar_url text,
  knowledge_score int, match_score int,
  overall_score int, overall_rank int,
  wins int, draws int, losses int,
  ahead_name text, ahead_points int
) language sql stable security definer set search_path = public as $$
  select r.user_id, r.display_name, r.avatar_url,
    r.knowledge_score, r.match_score,
    r.overall_score, r.overall_rank,
    r.wins, r.draws, r.losses,
    a.display_name, a.overall_score
  from yourscore_user_ratings r
  left join yourscore_user_ratings a on a.overall_rank = r.overall_rank - 1
  where r.user_id = p_user_id;
$$;

-- Leaderboard: global (p_user_ids null) or scoped to a set (friends + self).
create or replace function get_yourscore_leaderboard(p_user_ids uuid[] default null, p_limit int default 50)
returns table (
  user_id uuid, display_name text, avatar_url text,
  knowledge_score int, match_score int,
  overall_score int, overall_rank int,
  wins int, draws int, losses int
) language sql stable security definer set search_path = public as $$
  select r.user_id, r.display_name, r.avatar_url,
    r.knowledge_score, r.match_score,
    r.overall_score, r.overall_rank,
    r.wins, r.draws, r.losses
  from yourscore_user_ratings r
  where p_user_ids is null or r.user_id = any(p_user_ids)
  order by r.overall_rank asc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function get_yourscore_rank(uuid)               to anon, authenticated;
grant execute on function get_yourscore_leaderboard(uuid[], int) to anon, authenticated;

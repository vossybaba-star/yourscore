-- Fix the duplicate-rank bug in yourscore_user_ratings.
--
-- The view (migration 30) joined draft_standings on league_id ALONE. But
-- draft_standings holds one row per (user_id, league_id, competition) — PL, WC
-- and LaLiga each get their own row in the global league. So the join produced
-- MULTIPLE rows per player, which meant:
--   1. Anyone active in >1 competition got TWO overall_ranks. get_yourscore_rank
--      returned two rows and callers took [0] arbitrarily — one user showed at
--      both #45 and #4,895.
--   2. match_score was per-competition and never summed, so 280 users were
--      under-counted. Worst case: goat1993 saw 143,000 instead of 257,000.
--   3. Every rank was inflated by ~358 phantom rows sorted above the real ones.
--
-- The fix is to aggregate draft_standings PER USER before the join, summing
-- wins/draws/losses across every competition in the global league. One row per
-- player, one rank, the full record.
--
-- This was applied live to prod on 2026-07-21 to stop the visible double-ranks;
-- this migration records that DDL so the repo matches prod and a replay of
-- migration 30 can't silently bring the bug back. Idempotent (create or
-- replace), so re-applying is a no-op. The column list is unchanged, so the
-- dependent RPCs (get_yourscore_rank, get_yourscore_ladder,
-- get_yourscore_leaderboard) keep working without a drop/recreate.

create or replace view yourscore_user_ratings as
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
    coalesce(p.total_score, 0)::int                 as knowledge_score,
    (coalesce(ds.wins_all_time, 0) * 1500 + coalesce(ds.draws_all_time, 0) * 500)::int as match_score,
    coalesce(ds.wins_all_time, 0)::int              as wins,
    coalesce(ds.draws_all_time, 0)::int             as draws,
    coalesce(ds.losses_all_time, 0)::int            as losses,
    p.created_at                                    as created_at
  from profiles p
  left join (
    -- One aggregate row per user: sum the standings across ALL competitions in
    -- the global league, rather than joining each competition's row separately.
    select
      user_id,
      sum(coalesce(wins_all_time, 0))   as wins_all_time,
      sum(coalesce(draws_all_time, 0))  as draws_all_time,
      sum(coalesce(losses_all_time, 0)) as losses_all_time
    from draft_standings
    where league_id = '00000000-0000-0000-0000-000000000000'::uuid
    group by user_id
  ) ds on ds.user_id = p.id
) b;

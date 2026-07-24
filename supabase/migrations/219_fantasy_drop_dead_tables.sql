-- 219: Retire the duplicate-source fantasy tables.
--
-- fantasy_odds and fantasy_player_status are being dropped. Both are confirmed
-- 0 rows in production, so this is safe.
--
-- Why they are dead rather than merely unused:
--   * Injury/availability fact now comes from
--     fantasy_fpl_snapshot.chance_of_playing_next_round (see migration 210).
--     fantasy_player_status was an earlier, separate attempt at the same fact
--     from a different source — a second source of truth for one question.
--   * Odds are collected into fantasy_odds_snapshot (migration 210) as EVIDENCE
--     ONLY. Odds-derived signal was measured and must never be ranked on: it
--     cost −58 points/season (p=0.0001) when it fed the captaincy model. That
--     is the same failure shape as several previous bugs in this codebase —
--     two groups measured on different scales/sources, then compared or
--     combined as if they were one. fantasy_odds was the table that made that
--     mistake possible for odds specifically, so it is being removed rather
--     than left around to be reached for again.
--
-- Do not recreate fantasy_odds as a rankable input. If odds-derived signal is
-- ever revisited, it must be evaluated independently, on its own scale, before
-- it is allowed anywhere near a score.

drop table if exists public.fantasy_odds;
drop table if exists public.fantasy_player_status;

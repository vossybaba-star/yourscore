-- 82_fantasy_cash_points.sql — the round's cashed-out credits, as points.
--
-- Credits the bank can't hold cash out at 4 points each — the same 4 points an
-- extra transfer costs, so the economy is symmetric: knowledge buys transfers or
-- points, points buy transfers. It exists because a manager happy with his team
-- earned NOTHING from a perfect 11/11, and at the credit cap, literally zero.
--
-- This has to be a COLUMN, not a number folded into `points`. Scoring is a pure
-- recompute from the locked snapshot — every tick re-derives the whole gameweek —
-- so anything merely added to the total would be silently wiped by the next stat
-- correction. Stored here, it survives a re-score exactly like `hits` does.
begin;

alter table fantasy_entries
  add column if not exists cash_points int not null default 0;

commit;

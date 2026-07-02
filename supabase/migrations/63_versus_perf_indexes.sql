-- 63_versus_perf_indexes.sql
-- Versus record + rivalries aggregate over a user's matches across both games
-- with `where challenger_id = me OR opponent_id = me`. draft_matches already has
-- a challenger_id index but NOT opponent_id, so the OR seq-scanned all rows
-- (13k+). Add the missing opponent_id indexes so both sides of the OR use an
-- index (Postgres BitmapOr), making the hub's record/rivalries load fast.

create index if not exists draft_matches_opponent_idx
  on draft_matches (opponent_id, played_at desc);

create index if not exists h2h_challenges_opponent_idx
  on h2h_challenges (opponent_id);

-- 265_fantasy_readd_wildcard.sql — the wildcard is back (founder 7 Aug).
--
-- Reverses 212_fantasy_drop_wildcard. "Same as FPL": one wildcard issued per
-- half-season, use-it-or-lose-it at the halfway (GW19) deadline, giving unlimited
-- free transfers for one gameweek. It runs on its OWN track — separate from the
-- monthly triple_captain/bench_boost/insight rotation (chip_log), so playing it
-- never consumes a monthly chip.
--
-- Three columns, no more: the old bonus_wildcard_half is intentionally NOT
-- restored — there is no perfect-round bonus wildcard this time (FPL has none,
-- and minting chips from quizzes reopens the Insight→free-wildcard exploit).
alter table public.fantasy_squads
  add column if not exists wildcards     int not null default 0,  -- wildcards held right now (0 or 1 within a half)
  add column if not exists wildcard_half int,                     -- the half they're valid in; they expire crossing into the next
  -- The half we last handed out the wildcard for. Tracked apart from
  -- wildcard_half so issuance is idempotent: a manager who has spent their
  -- wildcard (wildcards=0, wildcard_half=this half) is not re-issued another
  -- one in the same half.
  add column if not exists issued_half   int;

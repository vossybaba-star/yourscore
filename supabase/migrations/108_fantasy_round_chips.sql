-- 84_fantasy_round_chips.sql — the two ROUND-side chips (design D:131).
--
-- Insight: a 50/50 on one question of your choosing. Which question you spent
-- it on must be stored, or a "deterministic, storage-free" hint could be
-- requested on every question in turn — a hint on ALL eleven.
--
-- Second Chance: retry one wrong answer after the round. Stored so it can only
-- ever be used once — the retry delta (an extra credit step, or a perfect-round
-- bonus) is granted exactly once, transactionally, against this marker.
begin;

alter table fantasy_entries
  add column if not exists round_hint_k  int,   -- question index Insight was spent on
  add column if not exists round_retry_k int;   -- question index Second Chance replayed

commit;

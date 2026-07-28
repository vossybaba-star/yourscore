-- 212_fantasy_drop_wildcard.sql — the wildcard is gone (founder 28 Jul).
--
-- A free full-rebuild contradicts the earn-your-transfers economy, and in a
-- monthly competition a bad squad isn't a season-wrecker — the knowledge loop is
-- the rescue. Removing the chip removes its whole per-half issue/expiry
-- machinery: 205_fantasy_chips added these columns, and nothing reads or writes
-- them any more (issueWildcards deleted from season.ts, perfectRoundReward gone
-- from engine.ts, playChip/removeChip no longer branch on the wildcard track).
--
-- The generic chip token (chips, chip_progress) STAYS for now — the monthly
-- set-of-three rotation that replaces the 4-gameweek accrual lands in its own
-- migration, alongside the server wiring for it.
--
-- Pre-launch (GW1 = 21 Aug) and fantasy is founder-only on prod, so the only
-- rows affected are the founder's own squad — a clean DROP is safe.
begin;

alter table fantasy_squads
  drop column if exists wildcards,
  drop column if exists wildcard_half,
  drop column if exists bonus_wildcard_half,
  drop column if exists issued_half;

commit;

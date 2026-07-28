-- 214_fantasy_monthly_chips.sql — chips move to the MONTHLY clock (founder 28 Jul).
--
-- The old model (205_fantasy_chips): a generic token accrued every 4 PLAYED
-- gameweeks, held up to 3 (columns `chips`, `chip_progress`). It's replaced by a
-- monthly rotation — one chip a month, a fresh set of three once all three are
-- used — because the competition players actually play for is monthly, and a
-- season-long chip with a mid-season expiry is calibrated to a clock they aren't
-- looking at.
--
-- The new state is a single append-only log: every chip played, newest last, each
-- stamped with its month. Both rules (one-a-month, use-all-three-before-repeating)
-- are pure functions of it (engine.ts: chipSetUsed / playedChipThisMonth /
-- availableChips / chipPlayable). No accrual, no held count — you simply always
-- have the current set, throttled to one a month.
--
-- Pre-launch (GW1 = 21 Aug), fantasy is founder-only on prod, so dropping the old
-- columns only touches the founder's own squad — a clean swap.
begin;

alter table fantasy_squads
  add column if not exists chip_log jsonb not null default '[]'::jsonb;

alter table fantasy_squads
  drop column if exists chips,
  drop column if exists chip_progress;

commit;

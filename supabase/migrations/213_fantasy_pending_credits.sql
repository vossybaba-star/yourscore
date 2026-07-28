-- 213_fantasy_pending_credits.sql — "earned for next week" (founder 28 Jul).
--
-- The pending tray. What you do THIS gameweek (the neutral round + your FIRST
-- gameday quiz) earns transfers for NEXT gameweek, on the 3/6/9/11 scale. Your
-- earned figure is the BEST of those two (override-upward: nothing lowers it,
-- only the first gameday quiz is ever counted, the round can raise it any time).
-- It accrues here — visible but not yet spendable — and is poured into the
-- spendable bank (credits) when the next gameweek opens, at which point it
-- resets. That N→N+1 hand-off is finaliseGameweek's job (season.ts).
begin;

alter table fantasy_squads
  -- Best transfers earned this cycle for next gameweek (0..4). Not spendable
  -- until settlement pours it into `credits`.
  add column if not exists pending_credits      int  not null default 0,
  -- First-gameday-only lock: once a gameday quiz has counted this cycle, no
  -- later gameday quiz is looked at again (the round can still override upward).
  add column if not exists pending_gameday_done  boolean not null default false,
  -- Which surface currently leads the pending figure — 'round' | 'gameday' |
  -- null. Display/ledger only; the number is the source of truth.
  add column if not exists pending_source        text;

commit;

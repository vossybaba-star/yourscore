-- 210_fantasy_ops.sql — fantasy-ops watchdog: an hourly, alert-first guard over
-- the live season. Adds the one flag it's allowed to write (ops_hold, Guard B's
-- veto on finalise — one-directional, only ever set true by the guard; cleared
-- by hand) and the dedupe state it needs so an unchanged finding doesn't
-- re-alert every hour.
begin;

alter table fantasy_gameweeks add column if not exists ops_hold boolean not null default false;

create table if not exists fantasy_ops_state (
  guard       text not null,           -- 'A' (calendar) | 'B' (facts)
  gw          int not null,
  fingerprint text not null,           -- hash of the current finding set, for dedupe
  alerted_at  timestamptz not null default now(),
  primary key (guard, gw)
);
-- service-role only, same posture as 200_fantasy.sql — no client policies.
alter table fantasy_ops_state enable row level security;

commit;

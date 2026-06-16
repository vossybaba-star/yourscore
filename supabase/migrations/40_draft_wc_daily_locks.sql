-- 40_draft_wc_daily_locks.sql
-- Anti-preview lock for the ranked daily World Cup draft.
--
-- The ranked draft is server-driven and one-per-day, but the run row isn't created until
-- submit — so a player could start the ranked draft, read the questions (their correct
-- answers are revealed per pick), bail, and re-draft with the answers known. This commits
-- the day's ranked attempt EARLY: once the player passes their 6th pick, a lock row is
-- written, and a new ranked draft that day is refused / blurred in the UI.
--
-- ADDITIVE. Server-only (service role); RLS on with no policies so the anon/auth client
-- can't read or write it.

begin;

create table if not exists draft_wc_daily_locks (
  user_id    uuid        not null,
  run_date   date        not null,
  picks      int         not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, run_date)
);

alter table draft_wc_daily_locks enable row level security;

commit;

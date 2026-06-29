-- 55_h2h_async.sql
-- Phase 1 async multiplayer. Turns h2h_challenges into a targetable, inbox-driven
-- async challenge:
--   invited_user_id   the friend a challenge is aimed at (NULL = open link;
--                     anyone with the URL may accept). Drives the Your-Turns inbox.
--   status            awaiting_opponent | complete | expired — drives inbox sections.
--   seen_by_opponent  unread state for the inbox badge.
-- Additive + a one-time status backfill. Existing link-based challenges keep working
-- (invited_user_id NULL = open, the current behaviour).

alter table h2h_challenges
  add column if not exists invited_user_id  uuid references auth.users(id) on delete set null,
  add column if not exists status           text not null default 'awaiting_opponent',
  add column if not exists seen_by_opponent boolean not null default false;

-- Backfill status for rows that pre-date the column (all currently default-valued).
update h2h_challenges
set status = case
  when opponent_score is not null then 'complete'
  when now() > expires_at         then 'expired'
  else 'awaiting_opponent'
end;

create index if not exists h2h_challenges_invited_idx    on h2h_challenges (invited_user_id, status);
create index if not exists h2h_challenges_challenger_idx on h2h_challenges (challenger_id, created_at desc);

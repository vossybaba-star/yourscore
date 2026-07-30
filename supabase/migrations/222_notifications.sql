-- 222_notifications.sql — in-app notification inbox (stage 2). ADDITIVE.
-- Targeted rows (comment_like aggregated per comment, comment_reply per reply)
-- + broadcast rows stored ONCE (user_id null), read against a single per-user
-- profiles.notifications_read_at marker. Writes are service-role only.
begin;

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,  -- null = broadcast
  type       text not null,  -- 'comment_like' | 'comment_reply' | 'daily_game' | 'daily_debate'
                             -- deliberately NO check: new types (friend_request, pending_turn)
                             -- move in without a migration (founder decision 1)
  actor_id   uuid references auth.users(id) on delete set null, -- latest actor; name joined at read
  comment_id uuid references comments(id) on delete cascade,    -- like: the liked comment · reply: the reply row
  subject_type text,          -- 'pack' | 'debate' — stage-3 deep-link seam
  subject_id   uuid,
  like_count int not null default 1,                            -- comment_like only
  title      text,                                              -- broadcasts only (immutable copy)
  body       text,                                              -- broadcasts only
  url        text not null,                                     -- '/debate' | '/play' | '/?focus=today|debate'
  dedupe_key text,                                              -- broadcasts: 'daily-game-push:<day>'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()                 -- bumped on like re-aggregation; drives unread + order
);

-- one aggregated row per liked comment
create unique index if not exists notifications_like_agg_idx
  on notifications (comment_id) where type = 'comment_like';
-- broadcast idempotency (DST double-fire, cron retry). NOT partial: a plain
-- unique index already allows unlimited NULLs (targeted rows never set
-- dedupe_key), and PostgREST's upsert(..., {onConflict:"dedupe_key"}) emits
-- a bare "ON CONFLICT (dedupe_key)" that Postgres can only match against a
-- non-partial index/constraint (a partial index here 42P10s every upsert).
create unique index if not exists notifications_dedupe_idx
  on notifications (dedupe_key);
-- inbox + unread reads
create index if not exists notifications_user_idx
  on notifications (user_id, updated_at desc);
create index if not exists notifications_broadcast_idx
  on notifications (created_at desc) where user_id is null;

alter table notifications enable row level security;
drop policy if exists "notifications read own or broadcast" on notifications;
create policy "notifications read own or broadcast" on notifications
  for select using (user_id = auth.uid() or user_id is null);
-- NO insert/update/delete policies: deny-all for anon/authenticated;
-- service_role bypasses RLS (all writes are server-side).

-- IG/Twitter read rule: one timestamp per user, opening /notifications sets it.
alter table profiles add column if not exists notifications_read_at timestamptz;

-- profiles uses column-level (not table-level) grants — a plain ADD COLUMN
-- gives a new column NO privileges for anon/authenticated, so an
-- authenticated-session read of this column 42501s until granted explicitly.
-- Read only: the app marks-read via the service-role client, never a user
-- session, so no UPDATE grant here.
grant select (notifications_read_at) on public.profiles to authenticated;

commit;

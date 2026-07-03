-- Versus redesign phase 1: public leagues + Quiz Battle instant-match queue.
-- ADDITIVE. Two independent pieces:
--   1. is_public / featured flags on both league tables so leagues can opt in to
--      the new "Discover public leagues" browse (default stays private).
--   2. quiz_queue + quiz_pair(): a random 1v1 queue for Quiz Battle, mirroring
--      the proven draft_live_queue / draft_live_pair design (FOR UPDATE SKIP
--      LOCKED claim of the oldest waiter, else enqueue self). The caller (API,
--      service role) creates the 1v1 Lobby after a successful pair.

begin;

-- 1. Public leagues ------------------------------------------------------------
alter table leagues       add column if not exists is_public boolean not null default false;
alter table leagues       add column if not exists featured  boolean not null default false;
alter table draft_leagues add column if not exists is_public boolean not null default false;
alter table draft_leagues add column if not exists featured  boolean not null default false;

-- Browse index: partial on the public slice (tiny), featured first, newest first.
create index if not exists leagues_public_idx
  on leagues (featured desc, created_at desc) where is_public;
create index if not exists draft_leagues_public_idx
  on draft_leagues (featured desc, created_at desc) where is_public;

-- `leagues` is already world-readable (leagues_read using(true)) — discovery just
-- filters on is_public. `draft_leagues` is members-only, so public ones need a
-- read policy of their own for the browse screen.
drop policy if exists "draft_leagues public read" on draft_leagues;
create policy "draft_leagues public read" on draft_leagues
  for select using (is_public);

-- 2. Quiz Battle instant-match queue --------------------------------------------
create table if not exists quiz_queue (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  enqueued_at timestamptz not null default now()
);
alter table quiz_queue enable row level security;
-- All access is via the service-role API (like draft_live_queue pairing); users
-- may still see/remove their own row.
drop policy if exists "quiz_queue self" on quiz_queue;
create policy "quiz_queue self" on quiz_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Atomic pairing: claim the oldest *fresh* waiter, else enqueue self and return
-- null. SKIP LOCKED means concurrent callers claim different waiters, so two
-- players can never be paired twice. Polling re-calls this, which refreshes
-- enqueued_at — so the 2-minute freshness window quietly drops anyone who
-- stopped polling without cancelling.
create or replace function quiz_pair(p_user uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_opp uuid;
begin
  select user_id into v_opp
    from quiz_queue
   where user_id <> p_user
     and enqueued_at > now() - interval '2 minutes'
   order by enqueued_at
   for update skip locked
   limit 1;

  if v_opp is not null then
    delete from quiz_queue where user_id in (v_opp, p_user);
    return v_opp;
  end if;

  insert into quiz_queue (user_id) values (p_user)
  on conflict (user_id) do update set enqueued_at = now();
  return null;
end;
$$;

-- Same hardening the advisor demanded of draft_live_pair (migration 52):
-- service-role-only execute + pinned search_path on the SECURITY DEFINER fn.
revoke execute on function public.quiz_pair(uuid) from public, anon, authenticated;
grant execute on function public.quiz_pair(uuid) to service_role;
alter function public.quiz_pair(uuid) set search_path = public;

commit;

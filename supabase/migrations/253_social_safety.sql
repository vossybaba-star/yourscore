-- 253_social_safety.sql — Social Phase 5a: report, block, mute.
--
-- social_reports is a write-only mailbox for the reporter: RLS lets an
-- authenticated user INSERT their own report (reporter_id = auth.uid()) but
-- grants NO select policy at all, so a report can't be read back by anyone
-- but service_role (the admin queue, /admin/reports) — mirrors migration 250
-- (link_previews): the app degrades to a friendly 503 if this table or a
-- write to it is absent (see lib/social/safety.ts's submitReport). The
-- unique index makes a (reporter, subject) report idempotent — resubmitting
-- just refreshes reason/created_at via upsert rather than piling up rows.
--
-- user_blocks is bidirectional in EFFECT (a block hides both people from each
-- other — enforced in application code, see hiddenActorIds) but stored as one
-- directed row per block, keyed (blocker_id, blocked_id) so a block is
-- idempotent and trivially unblocked. RLS is OWN-ROW: a user can select/
-- insert/delete only the rows where THEY are the blocker — nobody can read
-- who's blocked THEM, and nobody can block on someone else's behalf.
--
-- user_mutes is the SAME SHAPE as user_blocks (still (blocker_id, blocked_id),
-- same RLS) even though a mute is one-directional in effect — the muter only
-- hides the muted user's content from themselves, the muted user is never
-- told and sees the muter's content unaffected (see hiddenActorIds again:
-- blocks fold in both directions, mutes fold in only the muter's own row).
--
-- Written but NOT applied here (reviewer applies at ship time) — every read/
-- write these tables enable degrades gracefully while they're absent, same
-- discipline as migrations 250/251/252.

begin;

create table if not exists public.social_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  subject_type text not null check (subject_type in ('post', 'comment', 'profile')),
  subject_id  text not null,
  reason      text,
  created_at  timestamptz not null default now()
);

-- Backs the upsert in submitReport (one report per reporter per subject).
create unique index if not exists social_reports_reporter_subject_idx
  on public.social_reports (reporter_id, subject_type, subject_id);

create index if not exists social_reports_created_at_idx
  on public.social_reports (created_at desc);

alter table public.social_reports enable row level security;

drop policy if exists social_reports_insert on public.social_reports;
create policy social_reports_insert on public.social_reports
  for insert to authenticated with check (reporter_id = auth.uid());
-- NO select/update/delete policy for authenticated: a report is write-only
-- from the reporter's side. service_role (the admin queue) bypasses RLS.

create table if not exists public.user_blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists user_blocks_select on public.user_blocks;
create policy user_blocks_select on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());

drop policy if exists user_blocks_insert on public.user_blocks;
create policy user_blocks_insert on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists user_blocks_delete on public.user_blocks;
create policy user_blocks_delete on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- user_mutes: blocker_id/blocked_id columns are named for shape-parity with
-- user_blocks (same primary key, same RLS shape) — read them here as
-- muter_id/muted_id.
create table if not exists public.user_mutes (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create index if not exists user_mutes_blocked_idx
  on public.user_mutes (blocked_id);

alter table public.user_mutes enable row level security;

drop policy if exists user_mutes_select on public.user_mutes;
create policy user_mutes_select on public.user_mutes
  for select to authenticated using (blocker_id = auth.uid());

drop policy if exists user_mutes_insert on public.user_mutes;
create policy user_mutes_insert on public.user_mutes
  for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists user_mutes_delete on public.user_mutes;
create policy user_mutes_delete on public.user_mutes
  for delete to authenticated using (blocker_id = auth.uid());

commit;

-- "Notify me" for a specific fixture's halftime quiz.
--
-- One row per (user, fixture) = "tell me when THIS quiz drops". Deliberately
-- separate from profiles.notifications_opt_in: that's the blanket consent to be
-- pushed at all, this is an explicit request for one match. Release honours both
-- (see pushForFixture in src/lib/halftime/release.ts) — a requested push is
-- solicited, so it is exempt from the one-unsolicited-push-per-day cap.
--
-- NOTE (numbering): renumbered 85->98 on 2026-07-16 — see 96_pl_news.sql.

create table if not exists public.halftime_reminders (
  user_id     uuid not null references auth.users(id) on delete cascade,
  fixture_id  bigint not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, fixture_id)
);

-- Fan-out at release reads "who asked for THIS fixture" — index the lookup.
create index if not exists halftime_reminders_fixture_idx
  on public.halftime_reminders (fixture_id);

alter table public.halftime_reminders enable row level security;

-- A user may see, add and remove their OWN reminders. Unlike club_supporters
-- (locked for the season, hence no delete policy), a reminder is meant to be
-- undone — "Notify me" has to be a toggle, so delete-own is required.
create policy halftime_reminders_select_own on public.halftime_reminders
  for select using (auth.uid() = user_id);

create policy halftime_reminders_insert_own on public.halftime_reminders
  for insert with check (auth.uid() = user_id);

create policy halftime_reminders_delete_own on public.halftime_reminders
  for delete using (auth.uid() = user_id);

revoke all on public.halftime_reminders from public;
grant select, insert, delete on public.halftime_reminders to authenticated;

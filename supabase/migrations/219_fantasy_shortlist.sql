-- 219_fantasy_shortlist.sql — Scout · Shortlist (Stage 3a).
--
-- Research, not a transfer market: a place to SAVE players you may want to
-- investigate or compare later. One row per (user, player). No price, no buy/
-- sell — the star on the Players browser and the Shortlist tab both read/write
-- here, and the Briefing shows a preview.
--
-- The API talks to this over the service role (which bypasses RLS), but the
-- table still carries own-row client policies: the anon/authenticated key must
-- never be able to read or edit another manager's shortlist over raw REST.
begin;

create table if not exists fantasy_shortlist (
  user_id    uuid not null references auth.users(id) on delete cascade,
  player_id  int not null,                       -- pool id (= FPL element id)
  created_at timestamptz not null default now(),
  primary key (user_id, player_id)
);

-- Newest-first is the list's only sort, so index the read it always makes.
create index if not exists fantasy_shortlist_user_created_idx
  on fantasy_shortlist (user_id, created_at desc);

alter table fantasy_shortlist enable row level security;

-- Own-row only, for every verb the client could reach (service_role bypasses RLS).
drop policy if exists "fantasy_shortlist_own_read" on fantasy_shortlist;
create policy "fantasy_shortlist_own_read" on fantasy_shortlist
  for select using (auth.uid() = user_id);

drop policy if exists "fantasy_shortlist_own_insert" on fantasy_shortlist;
create policy "fantasy_shortlist_own_insert" on fantasy_shortlist
  for insert with check (auth.uid() = user_id);

drop policy if exists "fantasy_shortlist_own_delete" on fantasy_shortlist;
create policy "fantasy_shortlist_own_delete" on fantasy_shortlist
  for delete using (auth.uid() = user_id);

grant select, insert, delete on fantasy_shortlist to authenticated;

commit;

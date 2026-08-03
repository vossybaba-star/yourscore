-- Per-user read state for league chat, so a league row can show an UNREAD count
-- (founder, 3 Aug — "unread messages" on Home + the Leagues list). One row per
-- (league, member); last_read_at advances every time the member opens the chat.
-- Unread = league messages from OTHER members created after last_read_at.

create table if not exists public.fantasy_league_reads (
  league_id    uuid not null references public.fantasy_leagues(id) on delete cascade,
  user_id      uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.fantasy_league_reads enable row level security;

-- You only ever see and change your OWN read state. Server code that aggregates
-- unread counts for the list uses the service role and bypasses this.
drop policy if exists fantasy_league_reads_select on public.fantasy_league_reads;
create policy fantasy_league_reads_select on public.fantasy_league_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists fantasy_league_reads_insert on public.fantasy_league_reads;
create policy fantasy_league_reads_insert on public.fantasy_league_reads
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists fantasy_league_reads_update on public.fantasy_league_reads;
create policy fantasy_league_reads_update on public.fantasy_league_reads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

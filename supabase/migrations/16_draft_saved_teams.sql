-- 38-0 / Draft XI — saved-teams library.
--
-- draft_teams holds the ONE active/in-play team per user (matchmaking, leaderboard
-- and challenges all read it). This adds a separate library so a user can save many
-- named XIs and later load one back to play. Purely additive — nothing else changes.

begin;

create table if not exists draft_saved_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  formation text not null,                 -- '4-3-3' etc
  squad jsonb not null,                     -- PlacedPlayer[]
  strength_rating numeric not null,
  projected jsonb,                          -- {wins,draws,losses,points,position,tier} | null
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table draft_saved_teams enable row level security;

drop policy if exists "draft_saved_teams owner read" on draft_saved_teams;
create policy "draft_saved_teams owner read" on draft_saved_teams
  for select using (auth.uid() = user_id);

drop policy if exists "draft_saved_teams owner write" on draft_saved_teams;
create policy "draft_saved_teams owner write" on draft_saved_teams
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists draft_saved_teams_user_idx
  on draft_saved_teams (user_id, updated_at desc);

commit;

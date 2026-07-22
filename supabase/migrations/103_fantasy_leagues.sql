-- 79_fantasy_leagues.sql — Fantasy Phase 2: leagues (private by default, public opt-in).
-- RLS posture per 76_fantasy: member/public SELECT only; ALL writes via service role.
begin;

create table if not exists fantasy_leagues (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  join_code  text unique not null,
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists fantasy_league_members (
  league_id uuid not null references fantasy_leagues(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists fantasy_league_members_user_idx
  on fantasy_league_members (user_id);
create index if not exists fantasy_leagues_public_idx
  on fantasy_leagues (created_at desc) where is_public;

alter table fantasy_leagues enable row level security;
alter table fantasy_league_members enable row level security;

drop policy if exists fantasy_leagues_member_read on fantasy_leagues;
create policy fantasy_leagues_member_read on fantasy_leagues
  for select using (
    is_public
    or auth.uid() = owner_id
    or exists (
      select 1 from fantasy_league_members m
      where m.league_id = id and m.user_id = auth.uid()));

drop policy if exists fantasy_league_members_own_read on fantasy_league_members;
create policy fantasy_league_members_own_read on fantasy_league_members
  for select using (auth.uid() = user_id);

-- Deliberately NO insert/update/delete policies: RLS-enabled + no policy = deny-all for
-- anon/authenticated; service_role bypasses. No guard trigger needed.
commit;

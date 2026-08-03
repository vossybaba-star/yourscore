-- Club fan leagues + the Founder League (founder, 3 Aug). Every club with fans
-- gets a funny-named fan league; supporters are auto-joined. The first 1,000
-- managers to build a squad get the Founder League + an original Legend badge.
-- Club/founder leagues are OPEN to view but you can only contribute if you're a
-- member (a supporter / legend), and you can't join them by code — membership is
-- automatic.

alter table public.fantasy_leagues add column if not exists kind text not null default 'private';
alter table public.fantasy_leagues add column if not exists club text; -- supported-club name for kind='club'
create index if not exists fantasy_leagues_kind_idx on public.fantasy_leagues (kind);

-- The first 1,000 managers to build a squad — an original badge, ranked by squad
-- creation order. Public read so the badge renders anywhere; writes service-only.
create table if not exists public.fantasy_legends (
  user_id    uuid primary key,
  rank       int  not null,
  created_at timestamptz not null default now()
);
alter table public.fantasy_legends enable row level security;
drop policy if exists fantasy_legends_select on public.fantasy_legends;
create policy fantasy_legends_select on public.fantasy_legends for select using (true);

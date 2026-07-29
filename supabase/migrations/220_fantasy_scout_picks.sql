-- 220: Scout's Four Picks (Stage 4 of the Fantasy Scout).
--
-- One code-ranked player per category (Safe / Form / Value / Scout's Gamble),
-- drafted mechanically with an AI copy layer for the 2-3 factual reason lines
-- only (grounded against tips.ts's discipline — see scoutPicks.ts). Drafts land
-- here as 'draft'; an admin approves then publishes; ONLY 'published' rows are
-- ever read by a user-facing surface. No cron writes this table directly.
--
-- Applied to prod 2026-07-29.
--
-- RLS is enabled with NO policies => deny-all for anon/authenticated.
-- service_role (the admin routes + the read routes) bypasses RLS.

begin;

create table if not exists public.fantasy_scout_picks (
  id uuid primary key default gen_random_uuid(),
  gw int not null,
  category text not null check (category in ('safe','form','value','gamble')),
  status text not null default 'draft' check (status in ('draft','approved','published','rejected','superseded')),
  player_id int not null,
  backups jsonb not null default '[]',
  facts jsonb not null,
  reasons jsonb not null,
  risk text,
  signal text not null check (signal in ('season_ppg','fpl_ep_next_cold_start')),
  copy_source text not null default 'mechanical' check (copy_source in ('model','mechanical')),
  data_cutoff timestamptz not null,
  generated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz not null,
  rejected_reason text
);

create unique index if not exists fantasy_scout_picks_live on public.fantasy_scout_picks (gw, category) where status = 'published';
create unique index if not exists fantasy_scout_picks_draft on public.fantasy_scout_picks (gw, category) where status = 'draft';
create index if not exists fantasy_scout_picks_gw on public.fantasy_scout_picks (gw, status);
alter table public.fantasy_scout_picks enable row level security; -- no policies: service-role only

commit;

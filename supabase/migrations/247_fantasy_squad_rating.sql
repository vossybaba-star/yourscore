-- 247: Squad Rating cache ("Rate my squad").
--
-- The score is 100% code (squadRating.ts's scoreSquad()); the AI copy layer
-- only rephrases an already-computed score into a verdict + a couple of
-- pills. This table is the cache: one row per (user, squad_hash), so a
-- manager who hasn't touched their squad since their last rating never
-- triggers another model call, and `{fresh:true}` upserts the SAME row
-- (bounded to a few times a day — see the route) rather than growing one row
-- per re-ask.
--
-- RLS is enabled with NO policies => deny-all for anon/authenticated.
-- service_role (the /api/fantasy/squad-rating route) bypasses RLS. Mirrors
-- migration 220 (fantasy_scout_picks): a rating is read only through the
-- route, never directly by a client.

begin;

create table if not exists public.fantasy_squad_rating (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  squad_hash text not null,
  score numeric(3,1) not null,
  sub_scores jsonb not null,
  payload jsonb not null,
  snapshot_cutoff timestamptz not null,
  created_at timestamptz default now(),
  unique (user_id, squad_hash)
);

create index if not exists fantasy_squad_rating_user_created
  on public.fantasy_squad_rating (user_id, created_at desc);

alter table public.fantasy_squad_rating enable row level security; -- no policies: service-role only

commit;

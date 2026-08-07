-- 263: Scout's Latest — the daily, auto-published Scout recommender.
--
-- One row per day holding 1-3 code-selected player IDEAS (fixture swings,
-- ownership momentum, new doubts), each with an AI-written narrative reason
-- grounded against a closed facts payload (same discipline as scoutPicks.ts).
-- UNLIKE the Four Picks, there is NO draft/approve gate: a daily cron
-- (/api/cron/scout-latest, gated behind FANTASY_SCOUT_LATEST_ENABLED) selects
-- mechanically, grounds the copy, and upserts the day's row directly. That is
-- deliberate — the manual approve step is exactly what left the Four Picks
-- frozen for a week. Selection is 100% code; the model only rephrases facts.
--
-- Applied to prod 2026-08-07.
--
-- RLS is enabled with NO policies => deny-all for anon/authenticated.
-- service_role (the cron writer + the read route) bypasses RLS.

begin;

create table if not exists public.fantasy_scout_latest (
  day date primary key,
  gw int,
  items jsonb not null default '[]',
  data_cutoff timestamptz,
  generated_at timestamptz not null default now()
);

alter table public.fantasy_scout_latest enable row level security; -- no policies: service-role only

commit;

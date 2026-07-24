-- 110: Fixture context for Captain Assist explanations.
--
-- Purpose is EXPLANATION ONLY in this release. "Home to Everton" is far more
-- understandable than "strong fixture context" — but it must not change the
-- validated ranking logic. A fixture-adjusted MODEL would need its own model
-- version and its own evaluation, so nothing here feeds the score.
--
-- Frozen per recommendation (see fixture_context below) so a historical
-- explanation is never rebuilt from newer data: if a fixture is later postponed
-- or moved, what we told the user at the time remains reproducible.
--
-- Team ids here are FPL ids, the same id space as fantasy_fpl_snapshot.team, so
-- no mapping layer exists to drift. Names are stored alongside for display only;
-- all LOGIC must use ids.
--
-- Additive only.

create table if not exists public.fantasy_fixture_snapshot (
  id                     bigserial primary key,
  captured_at            timestamptz not null,
  fixture_id             int  not null,
  event                  int,                 -- gameweek; null = unscheduled
  team_h                 int,
  team_a                 int,
  team_h_name            text,
  team_a_name            text,
  kickoff_time           timestamptz,
  finished               boolean,
  provisional_start_time boolean,
  team_h_difficulty      int,
  team_a_difficulty      int,
  constraint fantasy_fixture_snapshot_uniq unique (captured_at, fixture_id)
);

create index if not exists fantasy_fixture_snapshot_event_idx
  on public.fantasy_fixture_snapshot (event, captured_at desc);
create index if not exists fantasy_fixture_snapshot_captured_idx
  on public.fantasy_fixture_snapshot (captured_at desc);

-- Append-only: a fixture snapshot is evidence of what the schedule looked like
-- at a moment in time.
create or replace function public.fantasy_fixture_snapshot_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'fantasy_fixture_snapshot is append-only: % not permitted', tg_op;
end;
$$;

drop trigger if exists fantasy_fixture_snapshot_append_only on public.fantasy_fixture_snapshot;
create trigger fantasy_fixture_snapshot_append_only
  before update or delete on public.fantasy_fixture_snapshot
  for each row execute function public.fantasy_fixture_snapshot_append_only();

alter table public.fantasy_fixture_snapshot enable row level security;

-- The fixture context actually shown to the user, frozen with the recommendation.
-- Shape: { "captain": { "fixtures": [{ "fixture_id": 1, "opponent_id": 7,
--          "opponent": "AVL", "home": true }], "label": "Home to AVL" }, ... }
alter table public.fantasy_captain_recommendation
  add column if not exists fixture_context jsonb;

-- 106: Immutable deadline squad + shadow evaluation hardening.
--
-- THE flaw this fixes: shadow mode recorded the user's captain when the
-- recommendation was FROZEN, which can be days before the deadline. A user who
-- changed their captain afterwards would be compared against a choice they never
-- actually made. The counterfactual is only honest if it is measured against
-- what the user ACTUALLY took into the gameweek.
--
-- So the user's final decision is captured at the deadline and made immutable.
-- Later team changes, correction jobs or re-runs cannot contaminate it.
--
-- Also adds, per the evaluation design:
--   * recommendation status, so one official record is evaluated rather than
--     whichever provisional version happened to perform best
--   * pre-declared exclusion reason codes, defined BEFORE seeing outcomes
--   * separate captain and vice outcomes, so the full vice fallback rule can be
--     applied rather than naively comparing two named captains
--
-- Additive only. No existing column is dropped or retyped.

create table if not exists public.fantasy_deadline_squad (
  id                bigserial primary key,
  user_id           uuid not null,
  gameweek          int  not null,
  captured_at       timestamptz not null default now(),
  xi                int[] not null,
  bench             int[],
  captain           int,
  vice              int,
  squad_fingerprint text,
  constraint fantasy_deadline_squad_uniq unique (user_id, gameweek)
);

create index if not exists fantasy_deadline_squad_gw_idx on public.fantasy_deadline_squad (gameweek);

-- Immutable: this is evidence, not state.
create or replace function public.fantasy_deadline_squad_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'the deadline squad snapshot is immutable: % not permitted', tg_op;
end;
$$;

drop trigger if exists fantasy_deadline_squad_immutable on public.fantasy_deadline_squad;
create trigger fantasy_deadline_squad_immutable
  before update or delete on public.fantasy_deadline_squad
  for each row execute function public.fantasy_deadline_squad_immutable();

alter table public.fantasy_deadline_squad enable row level security;

-- ── shadow evaluation hardening ─────────────────────────────────────────────
alter table public.fantasy_captain_shadow
  -- provisional | final_frozen | superseded | scored
  add column if not exists status                 text default 'final_frozen',
  add column if not exists eligible               boolean,
  -- no_active_squad | stale_snapshot | recommendation_after_deadline |
  -- missing_deadline_squad | illegal_squad | model_error |
  -- player_mapping_error | gameweek_not_final
  add column if not exists excluded_reason        text,
  -- the user's ACTUAL choice at the deadline (not at freeze time)
  add column if not exists deadline_captain       int,
  add column if not exists deadline_vice          int,
  -- captain/vice outcomes, kept separate so the fallback rule can be applied
  add column if not exists recommended_vice_points int,
  add column if not exists user_vice_points        int,
  add column if not exists recommended_effective_points int,
  add column if not exists user_effective_points        int,
  add column if not exists recommended_vice_activated   boolean,
  add column if not exists user_vice_activated          boolean,
  -- explicit model identity, so the GW6 switch is visible in every record
  add column if not exists model_identity          text,
  add column if not exists feature_version         text;

create index if not exists fantasy_captain_shadow_status_idx on public.fantasy_captain_shadow (status);

-- 105: Captain Assist — shadow evaluation and experiment assignment.
--
-- Shadow mode answers the only question that matters commercially: does the
-- recommendation beat what the user would have done anyway? The historical
-- backtest said yes against a synthetic manager; this measures it against REAL
-- users, which is the evidence required before any public performance claim.
--
-- Two records per user per gameweek, kept deliberately separate:
--   * what we recommended, frozen BEFORE the deadline
--   * what the user actually captained AT the deadline
-- scored only once official results are final. The difference between the two
-- IS the incremental team-score value of the captain decision, because the
-- captain slot adds one extra copy of that player's points.
--
-- Recommendation QUALITY and user ADOPTION are recorded separately: a good
-- recommendation the user ignored is not a failure of the model.
--
-- Additive only. No existing table is modified.

create table if not exists public.fantasy_captain_shadow (
  id                     bigserial primary key,
  user_id                uuid not null,
  gameweek               int  not null,
  recommendation_id      uuid references public.fantasy_captain_recommendation(id),

  -- frozen before the deadline
  frozen_at              timestamptz not null default now(),
  model_version          text,
  signal                 text,
  confidence             text,
  data_cutoff            timestamptz,
  recommended_captain    int  not null,
  recommended_vice       int,

  -- the user's real choice, captured AT the deadline
  user_captain           int,
  user_vice              int,
  followed               boolean,          -- user_captain = recommended_captain

  -- experiment arm at the time (shadow | treatment | control)
  exposure               text,

  -- scored only after official lock
  scored_at              timestamptz,
  scoring_version        text,
  recommended_points     int,
  user_points            int,
  difference             int,              -- recommended_points - user_points
  recommended_appeared   boolean,
  user_appeared          boolean,

  constraint fantasy_captain_shadow_uniq unique (user_id, gameweek)
);

create index if not exists fantasy_captain_shadow_gw_idx     on public.fantasy_captain_shadow (gameweek);
create index if not exists fantasy_captain_shadow_scored_idx on public.fantasy_captain_shadow (scored_at);

-- Stable experiment assignment. Assignment must NOT drift between gameweeks or
-- the comparison is meaningless, so it is written once and read thereafter.
create table if not exists public.fantasy_captain_experiment (
  user_id      uuid primary key,
  arm          text not null check (arm in ('treatment', 'control')),
  assigned_at  timestamptz not null default now(),
  assigned_gw  int
);

create or replace function public.fantasy_captain_experiment_stable()
returns trigger language plpgsql as $$
begin
  if new.arm is distinct from old.arm then
    raise exception 'experiment arm is fixed once assigned (user %)', old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists fantasy_captain_experiment_stable on public.fantasy_captain_experiment;
create trigger fantasy_captain_experiment_stable
  before update on public.fantasy_captain_experiment
  for each row execute function public.fantasy_captain_experiment_stable();

alter table public.fantasy_captain_shadow     enable row level security;
alter table public.fantasy_captain_experiment enable row level security;

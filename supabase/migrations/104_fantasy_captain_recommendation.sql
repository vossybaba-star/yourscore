-- 104: Captain Assist — frozen recommendation records.
--
-- Two jobs:
--  1) SAFETY. The card the user saw is frozen here with an id. Applying a change
--     must quote that id, and the server revalidates against it, so a stale card
--     (squad changed, new injury news, deadline passed) can never be applied and
--     the proposed player can never silently change between view and confirm.
--  2) EVALUATION. Shadow mode needs the recommendation exactly as it was shown,
--     with its model version and data cutoff, alongside what the user actually
--     did — that difference IS the measured value of the feature.
--
-- Additive only. No existing table is modified.
--
-- The frozen recommendation itself is immutable (append-only trigger); only the
-- outcome columns, which record what the user later did, may be updated once.

create table if not exists public.fantasy_captain_recommendation (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  gameweek            int,
  created_at          timestamptz not null default now(),

  -- the frozen recommendation, exactly as shown
  model_version       text not null,
  signal              text not null,          -- season_points_per_game | fpl_ep_next_cold_start
  data_cutoff         timestamptz not null,
  recommended_captain int  not null,
  recommended_vice    int  not null,
  alternatives        jsonb,
  confidence          text,
  warnings            jsonb,
  squad_fingerprint   text not null,          -- detects a squad change between view and confirm

  -- what the user had at the time
  previous_captain    int,
  previous_vice       int,

  -- outcome (written once, at confirmation)
  applied_captain     boolean not null default false,
  applied_vice        boolean not null default false,
  confirmed_at        timestamptz,
  outcome             text                     -- both | captain_only | vice_only | none | superseded
);

create index if not exists fantasy_captain_rec_user_idx on public.fantasy_captain_recommendation (user_id, created_at desc);
create index if not exists fantasy_captain_rec_gw_idx   on public.fantasy_captain_recommendation (gameweek);

-- The frozen fields must never change. Outcome columns may be filled in once.
create or replace function public.fantasy_captain_rec_freeze()
returns trigger language plpgsql as $$
begin
  if new.model_version       is distinct from old.model_version
  or new.signal              is distinct from old.signal
  or new.data_cutoff         is distinct from old.data_cutoff
  or new.recommended_captain is distinct from old.recommended_captain
  or new.recommended_vice    is distinct from old.recommended_vice
  or new.squad_fingerprint   is distinct from old.squad_fingerprint
  or new.user_id             is distinct from old.user_id
  or new.created_at          is distinct from old.created_at then
    raise exception 'the frozen part of a captain recommendation is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists fantasy_captain_rec_freeze on public.fantasy_captain_recommendation;
create trigger fantasy_captain_rec_freeze
  before update on public.fantasy_captain_recommendation
  for each row execute function public.fantasy_captain_rec_freeze();

alter table public.fantasy_captain_recommendation enable row level security;

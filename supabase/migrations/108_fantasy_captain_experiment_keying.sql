-- 108: Captain Assist — deterministic, versioned experiment assignment.
--
-- Assignment must be reproducible from (experiment_id, user_id) alone, so it can
-- be recomputed and audited later, and must be versioned so a future change to
-- the assignment rule is visible rather than silently rewriting history.
--
-- Re-keyed to (experiment_id, user_id) so a second experiment can exist without
-- colliding with this one, while a user still cannot land in two groups of the
-- SAME experiment. Safe: the table is empty at time of writing.
--
-- The arm-stability trigger from migration 105 still applies: once assigned,
-- an arm cannot change, because reassignment after seeing performance would
-- invalidate the comparison.

alter table public.fantasy_captain_experiment
  add column if not exists experiment_id      text not null default 'captain_assist_v1',
  add column if not exists assignment_version text not null default 'v1';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'fantasy_captain_experiment_pkey'
      and conrelid = 'public.fantasy_captain_experiment'::regclass
  ) then
    alter table public.fantasy_captain_experiment drop constraint fantasy_captain_experiment_pkey;
  end if;
end $$;

alter table public.fantasy_captain_experiment
  add constraint fantasy_captain_experiment_pkey primary key (experiment_id, user_id);

create index if not exists fantasy_captain_experiment_user_idx
  on public.fantasy_captain_experiment (user_id);

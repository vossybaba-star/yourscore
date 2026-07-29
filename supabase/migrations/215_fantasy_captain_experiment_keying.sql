-- 215: Captain Assist — deterministic, versioned experiment assignment.
--
-- Assignment must be reproducible from (experiment_id, user_id) alone, so it can
-- be recomputed and audited later, and must be versioned so a future change to
-- the assignment rule is visible rather than silently rewriting history.
--
-- Re-keyed to (experiment_id, user_id) so a second experiment can exist without
-- colliding with this one, while a user still cannot land in two groups of the
-- SAME experiment.
--
-- Re-run safety: this migration was hand-applied to production once already
-- (before it existed here under this number), where the pkey is already the
-- correct composite (experiment_id, user_id). Unconditionally dropping and
-- re-adding the pkey on every run is destructive-in-spirit even when the end
-- state matches — it briefly leaves the table with no primary key, and it is
-- unnecessary work on a key that is already correct. So the block below
-- inspects the ACTUAL existing primary key's column list and only touches the
-- constraint when it does not already match. On a fresh database (pkey is
-- still the single-column `user_id` from migration 212) this drops and
-- recreates it as designed; on production it is a no-op.
--
-- The arm-stability trigger from migration 212 still applies: once assigned,
-- an arm cannot change, because reassignment after seeing performance would
-- invalidate the comparison.

alter table public.fantasy_captain_experiment
  add column if not exists experiment_id      text not null default 'captain_assist_v1',
  add column if not exists assignment_version text not null default 'v1';

do $$
declare
  pk_name text;
  pk_cols text[];
begin
  select tc.constraint_name,
         array_agg(kcu.column_name order by kcu.ordinal_position)
    into pk_name, pk_cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.table_schema = tc.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'fantasy_captain_experiment'
    and tc.constraint_type = 'PRIMARY KEY'
  group by tc.constraint_name;

  if pk_cols is null or pk_cols <> array['experiment_id', 'user_id'] then
    if pk_name is not null then
      execute format('alter table public.fantasy_captain_experiment drop constraint %I', pk_name);
    end if;
    alter table public.fantasy_captain_experiment
      add constraint fantasy_captain_experiment_pkey primary key (experiment_id, user_id);
  end if;
end $$;

create index if not exists fantasy_captain_experiment_user_idx
  on public.fantasy_captain_experiment (user_id);

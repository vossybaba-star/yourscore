-- 111: Mark rehearsal rows so a dry run can never contaminate the evidence.
--
-- The end-to-end rehearsal must exercise the REAL code against the REAL tables,
-- or it proves nothing. But those tables are append-only by design: a synthetic
-- row written during a rehearsal cannot be deleted afterwards, and would sit in
-- the evaluation set forever, quietly inflating or deflating the measured uplift.
--
-- So rehearsal rows are flagged at write time and excluded from every evaluation
-- view. The rehearsal stays honest, and so does the evidence.
--
-- Additive only.

alter table public.fantasy_captain_recommendation add column if not exists is_rehearsal boolean not null default false;
alter table public.fantasy_captain_shadow         add column if not exists is_rehearsal boolean not null default false;
alter table public.fantasy_deadline_squad         add column if not exists is_rehearsal boolean not null default false;
alter table public.fantasy_captain_funnel         add column if not exists is_rehearsal boolean not null default false;
alter table public.fantasy_fpl_snapshot           add column if not exists is_rehearsal boolean not null default false;
alter table public.fantasy_fixture_snapshot       add column if not exists is_rehearsal boolean not null default false;

create index if not exists fantasy_captain_shadow_rehearsal_idx
  on public.fantasy_captain_shadow (is_rehearsal) where is_rehearsal;

-- Evaluation views must never see rehearsal rows.
create or replace view public.fantasy_captain_shadow_summary as
select
  s.gameweek,
  s.exposure,
  s.confidence,
  s.model_identity,
  count(*)                                                          as recommendations,
  count(*) filter (where s.eligible)                                as eligible,
  round(100.0 * count(*) filter (where s.eligible) / nullif(count(*), 0), 1) as eligible_pct,
  round(avg(s.difference) filter (where s.eligible)::numeric, 3)    as mean_uplift,
  sum(s.difference) filter (where s.eligible)                       as total_uplift,
  count(*) filter (where s.eligible and s.difference > 0)           as weeks_better,
  count(*) filter (where s.eligible and s.difference < 0)           as weeks_worse,
  count(*) filter (where s.eligible and s.difference = 0)           as weeks_same,
  round(100.0 * count(*) filter (where s.followed) / nullif(count(*) filter (where s.eligible), 0), 1) as followed_pct,
  round(100.0 * count(*) filter (where s.recommended_appeared) / nullif(count(*) filter (where s.eligible), 0), 1) as rec_appeared_pct,
  round(100.0 * count(*) filter (where s.user_appeared) / nullif(count(*) filter (where s.eligible), 0), 1)        as user_appeared_pct,
  count(*) filter (where s.recommended_vice_activated)              as rec_vice_activations,
  count(*) filter (where s.user_vice_activated)                     as user_vice_activations
from public.fantasy_captain_shadow s
where s.status = 'scored' and s.is_rehearsal = false
group by s.gameweek, s.exposure, s.confidence, s.model_identity;

create or replace view public.fantasy_captain_exclusions as
select gameweek, excluded_reason, count(*) as rows
from public.fantasy_captain_shadow
where excluded_reason is not null and is_rehearsal = false
group by gameweek, excluded_reason;

-- A dedicated view for inspecting what a rehearsal actually did.
create or replace view public.fantasy_captain_rehearsal as
select gameweek, status, exposure, confidence, model_identity,
       recommended_captain, recommended_vice, deadline_captain, deadline_vice,
       recommended_effective_points, user_effective_points, difference,
       recommended_vice_activated, user_vice_activated, eligible, excluded_reason
from public.fantasy_captain_shadow
where is_rehearsal = true;

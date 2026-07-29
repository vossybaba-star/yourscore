-- 214: Captain Assist — adoption funnel + evaluation views.
--
-- Recommendation QUALITY and product ADOPTION are different questions and must
-- not be conflated. A strong recommendation nobody sees, trusts or keeps until
-- the deadline has no product impact; a weak one that everybody follows is not
-- vindicated by adoption. So the funnel is recorded per user per gameweek,
-- separately from the shadow outcome.
--
-- Note the last two steps: a user can confirm a change and then reverse it. The
-- DEADLINE SQUAD, not the confirmation click, decides whether they followed it.
--
-- Additive only.

create table if not exists public.fantasy_captain_funnel (
  user_id                          uuid not null,
  gameweek                         int  not null,
  eligible                         boolean default false,
  recommendation_generated         boolean default false,
  recommendation_viewed            boolean default false,
  recommendation_expanded          boolean default false,
  prepare_clicked                  boolean default false,
  confirmation_opened              boolean default false,
  captain_applied                  boolean default false,
  vice_applied                     boolean default false,
  refresh_required                 boolean default false,
  blocked_after_deadline           boolean default false,
  dismissed                        boolean default false,
  -- decided from the immutable deadline squad, NOT from the confirm click
  recommendation_followed_at_deadline boolean,
  recommendation_scored            boolean default false,
  first_seen_at                    timestamptz,
  updated_at                       timestamptz not null default now(),
  primary key (user_id, gameweek)
);

create index if not exists fantasy_captain_funnel_gw_idx on public.fantasy_captain_funnel (gameweek);

alter table public.fantasy_captain_funnel enable row level security;

-- ── evaluation view ─────────────────────────────────────────────────────────
-- The dashboard is a query, not a spreadsheet. Reports the ELIGIBLE RATE beside
-- performance on purpose: a model that only works for 40% of users is not
-- launch-ready, and an uplift computed over a shrinking eligible set is a
-- flattering illusion.
create or replace view public.fantasy_captain_shadow_summary as
select
  s.gameweek,
  s.exposure,
  s.confidence,
  s.model_identity,
  count(*)                                                          as recommendations,
  count(*) filter (where s.eligible)                                as eligible,
  round(100.0 * count(*) filter (where s.eligible) / nullif(count(*), 0), 1) as eligible_pct,
  -- headline: effective captaincy uplift, vice fallback applied on both sides
  round(avg(s.difference) filter (where s.eligible)::numeric, 3)    as mean_uplift,
  sum(s.difference) filter (where s.eligible)                       as total_uplift,
  count(*) filter (where s.eligible and s.difference > 0)           as weeks_better,
  count(*) filter (where s.eligible and s.difference < 0)           as weeks_worse,
  count(*) filter (where s.eligible and s.difference = 0)           as weeks_same,
  -- adoption is tracked separately from quality
  round(100.0 * count(*) filter (where s.followed) / nullif(count(*) filter (where s.eligible), 0), 1) as followed_pct,
  round(100.0 * count(*) filter (where s.recommended_appeared) / nullif(count(*) filter (where s.eligible), 0), 1) as rec_appeared_pct,
  round(100.0 * count(*) filter (where s.user_appeared) / nullif(count(*) filter (where s.eligible), 0), 1)        as user_appeared_pct,
  count(*) filter (where s.recommended_vice_activated)              as rec_vice_activations,
  count(*) filter (where s.user_vice_activated)                     as user_vice_activations
from public.fantasy_captain_shadow s
where s.status = 'scored'
group by s.gameweek, s.exposure, s.confidence, s.model_identity;

-- Why rows fell out of the headline metric. Reported alongside performance so a
-- shrinking eligible set is visible rather than silent.
create or replace view public.fantasy_captain_exclusions as
select gameweek, excluded_reason, count(*) as rows
from public.fantasy_captain_shadow
where excluded_reason is not null
group by gameweek, excluded_reason;

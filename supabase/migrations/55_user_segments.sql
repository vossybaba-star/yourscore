-- 55_user_segments.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- User segmentation functions for targeted email campaigns.
--
-- All functions:
--   • Return table(user_id uuid, email text)
--   • Auto-exclude email_suppressions (bounces + unsubscribes)
--   • Are security definer, accessible only by service_role
--
-- Segments:
--   get_segment_wc_active(p_days)          — played ranked WC in last N days
--   get_segment_quiz_active(p_days)        — answered quiz questions in last N days
--   get_segment_both_active(p_days)        — active in WC AND quiz in last N days
--   get_segment_wc_only(p_days)            — active WC but not quiz in last N days
--   get_segment_quiz_only(p_days)          — active quiz but not WC in last N days
--   get_segment_engaged(p_days)            — any activity in last N days
--   get_segment_wc_lapsed(p_min, p_max)    — WC activity between X–Y days ago, not recently
--   get_segment_lapsed(p_min, p_max)       — any activity between X–Y days ago, not recently
--   get_segment_new_users(p_days)          — signed up in last N days
--   get_segment_never_played(p_min_days)   — signed up > N days ago, never played
--   get_segment_wc_streak(p_days, p_min)   — played WC on min N of last M days
--   get_segment_all_sendable()             — every non-suppressed user with email
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── helpers ─────────────────────────────────────────────────────────────────
-- Sendable users: has an email, not suppressed. Reused by every segment below
-- via a CTE to avoid repeating the suppression join.
-- We don't materialise this as a view (schema-level dep on auth.users).

-- ─── 1. wc_active ────────────────────────────────────────────────────────────
create or replace function get_segment_wc_active(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select distinct r.user_id, u.email
  from draft_wc_runs r
  join auth.users u on u.id = r.user_id
  where r.ranked = true
    and r.run_date >= current_date - p_days
    and u.email is not null
    and lower(trim(u.email)) not in (
      select lower(trim(email)) from email_suppressions
    )
  order by u.email;
$$;

-- ─── 2. classic_active ───────────────────────────────────────────────────────
-- Users who played classic 38-0 (draft_season_records) recently.
create or replace function get_segment_classic_active(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select distinct s.user_id, u.email
  from draft_season_records s
  join auth.users u on u.id = s.user_id
  where s.created_at >= now() - (p_days || ' days')::interval
    and u.email is not null
    and lower(trim(u.email)) not in (
      select lower(trim(email)) from email_suppressions
    )
  order by u.email;
$$;

-- ─── 2b. quiz_active ─────────────────────────────────────────────────────────
-- Users who answered standalone daily quiz questions (user_question_history).
-- Currently returns 0 — user_question_history not yet populated by the quiz flow.
-- Will become useful once /api/quiz/start writes are confirmed active.
create or replace function get_segment_quiz_active(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select distinct h.user_id, u.email
  from user_question_history h
  join auth.users u on u.id = h.user_id
  where h.played_at >= now() - (p_days || ' days')::interval
    and u.email is not null
    and lower(trim(u.email)) not in (
      select lower(trim(email)) from email_suppressions
    )
  order by u.email;
$$;

-- ─── 3. both_active ──────────────────────────────────────────────────────────
-- Users active in BOTH WC Mastermind AND quiz in last N days.
create or replace function get_segment_both_active(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with wc as (
    select distinct user_id from draft_wc_runs
    where ranked = true and run_date >= current_date - p_days
  ),
  quiz as (
    select distinct user_id from user_question_history
    where played_at >= now() - (p_days || ' days')::interval
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select w.user_id, u.email
  from wc w
  join quiz q on q.user_id = w.user_id
  join auth.users u on u.id = w.user_id
  where u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 4. wc_only ──────────────────────────────────────────────────────────────
-- Played WC but NOT answered any quiz in last N days.
create or replace function get_segment_wc_only(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with wc as (
    select distinct user_id from draft_wc_runs
    where ranked = true and run_date >= current_date - p_days
  ),
  quiz as (
    select distinct user_id from user_question_history
    where played_at >= now() - (p_days || ' days')::interval
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select w.user_id, u.email
  from wc w
  left join quiz q on q.user_id = w.user_id
  join auth.users u on u.id = w.user_id
  where q.user_id is null
    and u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 5. quiz_only ────────────────────────────────────────────────────────────
-- Played quiz but NOT played WC in last N days.
create or replace function get_segment_quiz_only(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with wc as (
    select distinct user_id from draft_wc_runs
    where ranked = true and run_date >= current_date - p_days
  ),
  quiz as (
    select distinct user_id from user_question_history
    where played_at >= now() - (p_days || ' days')::interval
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select q.user_id, u.email
  from quiz q
  left join wc w on w.user_id = q.user_id
  join auth.users u on u.id = q.user_id
  where w.user_id is null
    and u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 6. engaged ──────────────────────────────────────────────────────────────
-- Any activity (WC, classic 38-0, or standalone quiz) in last N days.
create or replace function get_segment_engaged(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with active as (
    select distinct user_id from draft_wc_runs
    where ranked = true and run_date >= current_date - p_days
    union
    select distinct user_id from user_question_history
    where played_at >= now() - (p_days || ' days')::interval
    union
    select distinct user_id from draft_season_records
    where created_at >= now() - (p_days || ' days')::interval
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select a.user_id, u.email
  from active a
  join auth.users u on u.id = a.user_id
  where u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 7. wc_lapsed ────────────────────────────────────────────────────────────
-- Played WC between p_max and p_min days ago, but NOT in the last p_min days.
-- Default: played 2–14 days ago, absent in last 2 days.
create or replace function get_segment_wc_lapsed(
  p_min_days int default 2,
  p_max_days int default 14
)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with recent as (
    select distinct user_id from draft_wc_runs
    where ranked = true and run_date >= current_date - p_min_days
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select distinct r.user_id, u.email
  from draft_wc_runs r
  join auth.users u on u.id = r.user_id
  left join recent rec on rec.user_id = r.user_id
  where r.ranked = true
    and r.run_date between current_date - p_max_days and current_date - p_min_days
    and rec.user_id is null
    and u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 8. lapsed (any game) ────────────────────────────────────────────────────
-- Had any activity between p_max and p_min days ago, but none in last p_min days.
create or replace function get_segment_lapsed(
  p_min_days int default 2,
  p_max_days int default 14
)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with all_activity as (
    select user_id, run_date::timestamptz as played_at from draft_wc_runs where ranked = true
    union all
    select user_id, played_at from user_question_history
    union all
    select user_id, created_at as played_at from draft_season_records
  ),
  recent as (
    select distinct user_id from all_activity
    where played_at >= now() - (p_min_days || ' days')::interval
  ),
  in_window as (
    select distinct user_id from all_activity
    where played_at >= now() - (p_max_days || ' days')::interval
      and played_at <  now() - (p_min_days || ' days')::interval
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select w.user_id, u.email
  from in_window w
  left join recent r on r.user_id = w.user_id
  join auth.users u on u.id = w.user_id
  where r.user_id is null
    and u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 9. new_users ────────────────────────────────────────────────────────────
-- Signed up in the last N days.
create or replace function get_segment_new_users(p_days int default 7)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select u.id as user_id, u.email
  from auth.users u
  where u.created_at >= now() - (p_days || ' days')::interval
    and u.email is not null
    and lower(trim(u.email)) not in (
      select lower(trim(email)) from email_suppressions
    )
  order by u.email;
$$;

-- ─── 10. never_played ────────────────────────────────────────────────────────
-- Signed up at least p_min_signup_days ago but has never played anything.
create or replace function get_segment_never_played(p_min_signup_days int default 1)
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  with ever_played as (
    select distinct user_id from draft_wc_runs where ranked = true
    union
    select distinct user_id from user_question_history
    union
    select distinct user_id from draft_season_records
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select u.id as user_id, u.email
  from auth.users u
  left join ever_played ep on ep.user_id = u.id
  where ep.user_id is null
    and u.created_at <= now() - (p_min_signup_days || ' days')::interval
    and u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by u.email;
$$;

-- ─── 11. wc_streak ───────────────────────────────────────────────────────────
-- Played WC Mastermind on at least p_min_streak of the last p_days days.
-- Good for identifying your most engaged power users.
create or replace function get_segment_wc_streak(
  p_days     int default 7,
  p_min_streak int default 5
)
returns table(user_id uuid, email text, days_played int)
language sql stable security definer set search_path = public as $$
  with run_counts as (
    select user_id, count(distinct run_date)::int as days_played
    from draft_wc_runs
    where ranked = true and run_date >= current_date - p_days
    group by user_id
    having count(distinct run_date) >= p_min_streak
  ),
  suppressed as (
    select lower(trim(email)) as email from email_suppressions
  )
  select rc.user_id, u.email, rc.days_played
  from run_counts rc
  join auth.users u on u.id = rc.user_id
  where u.email is not null
    and lower(trim(u.email)) not in (select email from suppressed)
  order by rc.days_played desc, u.email;
$$;

-- ─── 12. all_sendable ────────────────────────────────────────────────────────
-- Every user with a confirmed email, not in suppressions. Full blast list.
create or replace function get_segment_all_sendable()
returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select u.id as user_id, u.email
  from auth.users u
  where u.email is not null
    and lower(trim(u.email)) not in (
      select lower(trim(email)) from email_suppressions
    )
  order by u.email;
$$;

-- ─── permissions: service_role only ──────────────────────────────────────────
do $$
declare
  fns text[] := array[
    'get_segment_wc_active(int)',
    'get_segment_classic_active(int)',
    'get_segment_quiz_active(int)',
    'get_segment_both_active(int)',
    'get_segment_wc_only(int)',
    'get_segment_quiz_only(int)',
    'get_segment_engaged(int)',
    'get_segment_wc_lapsed(int,int)',
    'get_segment_lapsed(int,int)',
    'get_segment_new_users(int)',
    'get_segment_never_played(int)',
    'get_segment_wc_streak(int,int)',
    'get_segment_all_sendable()'
  ];
  fn text;
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

commit;

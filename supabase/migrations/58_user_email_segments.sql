-- Per-user email segmentation context.
--
-- profiles.games_played is a dead counter (never incremented), so activity is
-- derived live from the real game tables. This view rolls each user up into the
-- attributes our email sends need: engagement tier (the primary spine), what
-- they play (content selector), social state, and personalisation fields
-- (name, score, country, timezone). One row per profile.
--
-- Read by scripts/segments.mjs via get_email_segments() (service role only).
-- NO email here — that's joined in JS from auth.users, so this stays PII-light.

create or replace view public.user_email_segments as
with activity as (
  select user_id as uid, completed_at as ts, 'quiz'::text as g from quiz_attempts where user_id is not null
  union all select user_id, coalesce(resolved_at, created_at), 'wc' from draft_wc_runs where user_id is not null
  union all select challenger_id, played_at, 'c38' from draft_matches where challenger_id is not null
  union all select opponent_id, played_at, 'c38' from draft_matches where opponent_id is not null
  union all select p1_id, created_at, 'live' from draft_live_matches where p1_id is not null
  union all select p2_id, created_at, 'live' from draft_live_matches where p2_id is not null
),
rolled as (
  select uid,
    max(ts) as last_active_at,
    count(*) as total_games,
    count(*) filter (where g = 'quiz') as quiz_games,
    count(*) filter (where g = 'wc') as wc_games,
    count(*) filter (where g in ('c38', 'live')) as g38_games
  from activity group by uid
),
leagues as (
  select user_id as uid from league_members
  union select user_id from draft_league_members
),
friends as (
  select user_id as uid from friendships
  union select friend_id from friendships
)
select
  p.id as user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, '')) as name,
  p.total_score,
  p.country,
  p.timezone,
  p.active_hour_utc,
  p.notifications_opt_in,
  p.created_at as signed_up_at,
  (p.created_at > now() - interval '7 days') as is_new,
  coalesce(r.total_games, 0) as total_games,
  coalesce(r.quiz_games, 0) as quiz_games,
  coalesce(r.wc_games, 0) as wc_games,
  coalesce(r.g38_games, 0) as g38_games,
  r.last_active_at,
  case when r.last_active_at is not null
       then floor(extract(epoch from (now() - r.last_active_at)) / 86400)::int end as days_since_active,
  case
    when r.last_active_at is null then 'never'
    when r.last_active_at > now() - interval '7 days' then 'active'
    when r.last_active_at > now() - interval '14 days' then 'cooling'
    else 'dormant'
  end as engagement_tier,
  case
    when coalesce(r.total_games, 0) = 0 then null
    when r.wc_games >= r.g38_games and r.wc_games >= r.quiz_games then 'wc'
    when r.g38_games >= r.quiz_games then '38'
    else 'quiz'
  end as primary_game,
  (coalesce(r.wc_games, 0) > 0) as plays_wc,
  (coalesce(r.g38_games, 0) > 0) as plays_38,
  (coalesce(r.quiz_games, 0) > 0) as plays_quiz,
  ((coalesce(r.wc_games, 0) > 0)::int + (coalesce(r.g38_games, 0) > 0)::int + (coalesce(r.quiz_games, 0) > 0)::int) >= 2 as multi_game,
  (lg.uid is not null) as in_league,
  (fr.uid is not null) as has_friends
from profiles p
left join rolled r on r.uid = p.id
left join leagues lg on lg.uid = p.id
left join friends fr on fr.uid = p.id;

-- Service-role accessor: returns the whole segment table as one jsonb blob so the
-- script reads it in a single call (no PostgREST row cap, no pagination).
create or replace function public.get_email_segments()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.user_email_segments s;
$$;

-- Lock both down: this carries activity + score + geo. Only the service role
-- (which bypasses RLS / runs the function) should ever read it.
revoke all on public.user_email_segments from anon, authenticated;
revoke all on function public.get_email_segments() from anon, authenticated;

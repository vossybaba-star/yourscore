-- Add "played_wc_ranked" to the segmentation context: has the user ever played a
-- RANKED World Cup run (i.e. the daily Mastermind Edition, ranked=true) — as opposed
-- to only the open World Cup Run / "World Cup XI" (ranked=false, unlimited, no board).
--
-- Powers the WC-XI-vs-Mastermind win-back: people who build squads in the open Run but
-- have never tried the ranked daily don't realise the two are different. This flag lets
-- us target "plays WC but never ranked" precisely. It recomputes live on every read, so
-- the moment someone plays their first ranked run they reclassify automatically.
--
-- Rebuilt from migration 59 (the current definition) + one trailing column. All prior
-- columns preserved verbatim.

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
first_act as (
  select distinct on (uid)
    uid,
    case when g in ('c38', 'live') then '38' else g end as first_game,
    ts as first_game_at
  from activity order by uid, ts asc
),
wc_ranked as (
  select distinct user_id as uid from draft_wc_runs where user_id is not null and ranked
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
  (fr.uid is not null) as has_friends,
  fa.first_game,
  fa.first_game_at,
  (wr.uid is not null) as played_wc_ranked
from profiles p
left join rolled r on r.uid = p.id
left join first_act fa on fa.uid = p.id
left join wc_ranked wr on wr.uid = p.id
left join leagues lg on lg.uid = p.id
left join friends fr on fr.uid = p.id;

-- 39_draft_wc_daily.sql
-- World Cup Daily — turn the World Cup Run into a daily, ranked competition.
--
-- ADDITIVE. Extends draft_wc_runs with a daily/ranked dimension and adds a season
-- leaderboard read. Does NOT touch draft_standings / YourScore Rank (that crediting is
-- handled separately in app code). The play-off shootout games (stage='playoff') are a
-- qualification GATE and are excluded from the W/D/L record + points.

begin;

-- A ranked run is one-per-user-per-day; practice runs leave these null/false.
alter table draft_wc_runs add column if not exists run_date date;
alter table draft_wc_runs add column if not exists ranked boolean not null default false;

-- One ranked attempt per user per day (the integrity rule — no redrafting once the
-- questions are seen). Practice runs (ranked=false) are unconstrained.
create unique index if not exists draft_wc_runs_daily_uidx
  on draft_wc_runs (user_id, run_date) where ranked;
create index if not exists draft_wc_runs_ranked_date_idx
  on draft_wc_runs (ranked, run_date);

-- Season leaderboard: aggregate ranked runs' match records within [p_start, p_end].
-- Points = 3*wins + 1*draws (used only to rank). Play-off games don't count.
create or replace function get_wc_daily_leaderboard(p_start date, p_end date, p_limit int default 100)
returns table (
  user_id uuid, display_name text, avatar_url text,
  wins int, draws int, losses int, points int, days int, rank int
) language sql stable security definer set search_path = public as $$
  with agg as (
    select r.user_id,
      count(*) filter (where m.won = true  and m.stage <> 'playoff')::int as wins,
      count(*) filter (where m.won is null and m.stage <> 'playoff')::int as draws,
      count(*) filter (where m.won = false and m.stage <> 'playoff')::int as losses,
      count(distinct r.run_date)::int as days
    from draft_wc_runs r
    join draft_wc_matches m on m.run_id = r.id
    where r.ranked and r.run_date between p_start and p_end
    group by r.user_id
  )
  select a.user_id,
    coalesce(nullif(p.display_name, ''), 'Player') as display_name, p.avatar_url,
    a.wins, a.draws, a.losses,
    (a.wins * 3 + a.draws)::int as points, a.days,
    row_number() over (order by (a.wins * 3 + a.draws) desc, a.wins desc, a.days asc)::int as rank
  from agg a
  join profiles p on p.id = a.user_id
  order by points desc, a.wins desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;
grant execute on function get_wc_daily_leaderboard(date, date, int) to anon, authenticated;

commit;

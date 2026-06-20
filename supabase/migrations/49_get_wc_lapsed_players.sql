-- 49_get_wc_lapsed_players.sql
-- Returns {user_id, email} for users who completed a ranked WC run on p_played_date
-- but have NOT yet started one on p_today_date. Used by the lapsed-player email.

begin;

create or replace function get_wc_lapsed_players(p_played_date date, p_today_date date)
returns table(user_id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select distinct r.user_id, u.email
  from draft_wc_runs r
  join auth.users u on u.id = r.user_id
  where r.ranked = true
    and r.run_date = p_played_date
    and r.user_id not in (
      select user_id from draft_wc_runs
      where ranked = true and run_date = p_today_date
    )
  order by u.email;
$$;

revoke all on function get_wc_lapsed_players(date, date) from public;
revoke all on function get_wc_lapsed_players(date, date) from anon;
revoke all on function get_wc_lapsed_players(date, date) from authenticated;
grant execute on function get_wc_lapsed_players(date, date) to service_role;

commit;

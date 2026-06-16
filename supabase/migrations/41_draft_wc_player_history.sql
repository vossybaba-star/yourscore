-- 41_draft_wc_player_history.sql
-- World Cup Daily — let anyone browse a player's ranked-run history from the season
-- board: each day's draft (squad + formation + strength), the result (W/D/L, stage
-- reached, status) and the match-by-match breakdown.
--
-- ADDITIVE + READ-ONLY. draft_wc_runs / draft_wc_matches are owner-only under RLS, so a
-- SECURITY DEFINER function (granted to anon/authenticated, like get_wc_daily_leaderboard)
-- is the only way to expose other players' drafts on the public board. W/D/L is computed
-- exactly as the leaderboard does (playoff games excluded) so per-player totals match.

begin;

create or replace function get_wc_player_history(p_user uuid, p_start date, p_end date)
returns table (
  run_id uuid, run_date date, formation text, squad jsonb, strength numeric,
  status text, stage text,
  wins int, draws int, losses int, points int,
  display_name text, avatar_url text,
  matches jsonb
) language sql stable security definer set search_path = public as $$
  select
    r.id, r.run_date, r.formation, r.squad, r.strength,
    r.status, r.stage,
    coalesce(m.wins, 0), coalesce(m.draws, 0), coalesce(m.losses, 0),
    (coalesce(m.wins, 0) * 3 + coalesce(m.draws, 0))::int as points,
    coalesce(nullif(p.display_name, ''), 'Player') as display_name, p.avatar_url,
    coalesce(m.matches, '[]'::jsonb) as matches
  from draft_wc_runs r
  join profiles p on p.id = r.user_id
  left join lateral (
    select
      count(*) filter (where won is true  and stage <> 'playoff')::int as wins,
      count(*) filter (where won is null  and stage <> 'playoff')::int as draws,
      count(*) filter (where won is false and stage <> 'playoff')::int as losses,
      jsonb_agg(jsonb_build_object(
        'stage', stage, 'idx', idx,
        'opponent_nation', opponent_nation, 'opponent_crest', opponent_crest,
        'opponent_strength', opponent_strength,
        'you_goals', you_goals, 'opp_goals', opp_goals,
        'pens_you', pens_you, 'pens_opp', pens_opp, 'won', won
      ) order by played_at) as matches
    from draft_wc_matches
    where run_id = r.id
  ) m on true
  where r.user_id = p_user and r.ranked and r.run_date between p_start and p_end
  order by r.run_date desc;
$$;

grant execute on function get_wc_player_history(uuid, date, date) to anon, authenticated;

commit;

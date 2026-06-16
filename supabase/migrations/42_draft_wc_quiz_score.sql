-- 42_draft_wc_quiz_score.sql
-- Record the Mastermind quiz score on each ranked World Cup run (how many of the day's
-- questions the player answered correctly) and surface it in the board history.
--
-- ADDITIVE. quiz_correct/quiz_total are nullable — runs created before this migration
-- have no recorded score (we only stored the squad, not the answers), so they read NULL
-- and the UI omits the chip. New ranked runs record it at submit.

begin;

alter table draft_wc_runs add column if not exists quiz_correct int;
alter table draft_wc_runs add column if not exists quiz_total   int;

-- Extend get_wc_player_history with the per-run quiz score (otherwise unchanged from 41).
-- DROP first: adding OUT columns changes the return type, which CREATE OR REPLACE rejects.
drop function if exists get_wc_player_history(uuid, date, date);
create or replace function get_wc_player_history(p_user uuid, p_start date, p_end date)
returns table (
  run_id uuid, run_date date, formation text, squad jsonb, strength numeric,
  status text, stage text,
  wins int, draws int, losses int, points int,
  quiz_correct int, quiz_total int,
  display_name text, avatar_url text,
  matches jsonb
) language sql stable security definer set search_path = public as $$
  select
    r.id, r.run_date, r.formation, r.squad, r.strength,
    r.status, r.stage,
    coalesce(m.wins, 0), coalesce(m.draws, 0), coalesce(m.losses, 0),
    (coalesce(m.wins, 0) * 3 + coalesce(m.draws, 0))::int as points,
    r.quiz_correct, r.quiz_total,
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

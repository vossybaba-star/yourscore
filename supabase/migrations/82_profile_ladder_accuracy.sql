-- Profile page redesign: the ladder band + true lifetime quiz accuracy.
--
-- Neither function changes what feeds YourScore Rank — they only read. Widening
-- Rank to cover the newer games is a separate, deliberate decision.

-- ---------------------------------------------------------------------------
-- get_yourscore_ladder — a window of players around you, for the profile hero.
--
-- get_yourscore_leaderboard is top-N only, so windowing around rank ~5,000 there
-- would mean pulling 5,000 rows through PostgREST (which silently caps at 1000).
-- This returns exactly the 2 above / you / 1 below.
--
-- Cost: yourscore_user_ratings materialises + sorts every user on each call, so
-- this is O(all users) — ~30ms at ~10k users, and it grows linearly. When that
-- starts to hurt, materialise the view rather than tuning this function.
-- ---------------------------------------------------------------------------
create or replace function get_yourscore_ladder(p_user_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  overall_score int,
  overall_rank int,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select overall_rank from yourscore_user_ratings where user_id = p_user_id
  )
  select r.user_id, r.display_name, r.avatar_url,
         r.overall_score, r.overall_rank,
         (r.user_id = p_user_id)
  from yourscore_user_ratings r, me
  where r.overall_rank between me.overall_rank - 2 and me.overall_rank + 1
  order by r.overall_rank asc;
$$;

-- ---------------------------------------------------------------------------
-- get_profile_accuracy — lifetime "answers you got right", across every quiz
-- surface that actually persists a graded answer.
--
-- Read-time on purpose: every column below already has a live writer, so there
-- is nothing to backfill and nothing to keep in sync. A denormalised column
-- would need both.
--
-- Sources, and why these three:
--   quiz_attempts  — daily/pack quiz. `answers` is a graded array, so
--                    jsonb_array_length IS the total; no join to
--                    quiz_packs.question_count needed.
--   room_scores    — lobbies/multiplayer. Already carries correct/total.
--   draft_wc_runs  — the WC Mastermind gate quiz. quiz_total is null on runs
--                    from before migration 42, hence the filter.
--
-- Deliberately excluded: h2h_challenges and group_challenge_participants. Both
-- carry usable accuracy, but h2h needs a two-sided challenger/opponent branch
-- for ~45 rows of data. Worth adding only if completeness starts to matter.
--
-- Not a source: challenge_attempts is empty and has no writer anywhere in src/.
-- ---------------------------------------------------------------------------
create or replace function get_profile_accuracy(p_user_id uuid)
returns table (correct bigint, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c), 0)::bigint, coalesce(sum(t), 0)::bigint
  from (
    select coalesce(correct_count, 0) as c, jsonb_array_length(answers) as t
    from quiz_attempts
    where user_id = p_user_id and jsonb_typeof(answers) = 'array'
    union all
    select coalesce(correct_answers, 0), coalesce(total_answers, 0)
    from room_scores
    where user_id = p_user_id
    union all
    select coalesce(quiz_correct, 0), coalesce(quiz_total, 0)
    from draft_wc_runs
    where user_id = p_user_id and quiz_total is not null
  ) s;
$$;

-- ---------------------------------------------------------------------------
-- get_best_wc_run — the player's actual best World Cup run.
--
-- Wins are a count over draft_wc_matches, so this can't be ordered client-side
-- without pulling every run. The profile page previously took an unordered
-- .limit(50) of a 22k-row table and called the max of that a "personal best" —
-- it wasn't. Champion outranks win-count: an 8-game champion beats a 7-win
-- finalist.
-- ---------------------------------------------------------------------------
create or replace function get_best_wc_run(p_user_id uuid)
returns table (nation text, champion boolean, wins bigint, games bigint)
language sql
stable
security definer
set search_path = public
as $$
  select r.nation,
         (r.status = 'champion'),
         count(*) filter (where m.won),
         count(m.*)
  from draft_wc_runs r
  join draft_wc_matches m on m.run_id = r.id
  where r.user_id = p_user_id
  group by r.id, r.nation, r.status
  order by (r.status = 'champion') desc, count(*) filter (where m.won) desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- get_best_quiz — best quiz round, measured in questions right.
--
-- NOT score/max_score: score carries speed bonuses that max_score doesn't, so
-- score exceeds max_score on ~9% of attempts and renders as "5950/4800".
-- correct_count over jsonb_array_length(answers) is the number a player would
-- actually recognise, and it can't exceed its own denominator.
-- ---------------------------------------------------------------------------
create or replace function get_best_quiz(p_user_id uuid)
returns table (correct int, total int, title text)
language sql
stable
security definer
set search_path = public
as $$
  select a.correct_count,
         jsonb_array_length(a.answers),
         p.title
  from quiz_attempts a
  left join quiz_packs p on p.id = a.pack_id
  where a.user_id = p_user_id
    and jsonb_typeof(a.answers) = 'array'
    and jsonb_array_length(a.answers) > 0
  order by (a.correct_count::numeric / jsonb_array_length(a.answers)) desc,
           a.correct_count desc
  limit 1;
$$;

-- EXECUTE is granted to PUBLIC by default, so revoking from anon/authenticated
-- alone would be a no-op. All four are per-user reads of data already exposed
-- on public leaderboards, so PUBLIC execute is intended here.
grant execute on function get_yourscore_ladder(uuid) to anon, authenticated;
grant execute on function get_profile_accuracy(uuid) to anon, authenticated;
grant execute on function get_best_wc_run(uuid) to anon, authenticated;
grant execute on function get_best_quiz(uuid) to anon, authenticated;

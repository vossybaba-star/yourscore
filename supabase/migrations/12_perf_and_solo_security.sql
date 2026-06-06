-- 12_perf_and_solo_security.sql
--
-- (A) SECURITY — make solo quiz_attempts server-authoritative.
--     Previously the solo-challenge page graded in the browser and inserted a
--     self-reported score straight into quiz_attempts via the anon key. RLS only
--     checked user_id = auth.uid(), never the value, so any user could POST an
--     arbitrary score and top the public solo leaderboard. Dropping the client
--     INSERT policy means rows can now only be written by the service role
--     (via /api/quiz/solo-complete, which grades from the pack's answers).
--     SELECT policies are left intact so leaderboards still read.
drop policy if exists "quiz_attempts_insert_own" on quiz_attempts;

-- (B) PERFORMANCE — set-based timeout penalty.
--     /api/room/next previously looped one upsert per unanswered player on every
--     question advance (up to max_players round-trips while the next question was
--     blocked). Collapse to a single set-based UPDATE. New players with no score
--     row stay at an implicit 0 (a -25 penalty floored at 0 == no row), so an
--     UPDATE-only is equivalent to the old upsert in end state.
create or replace function apply_timeout_penalty(
  p_room_id uuid,
  p_user_ids uuid[],
  p_penalty integer
) returns void
language sql
security definer
set search_path = public
as $$
  update room_scores
     set total_score = greatest(0, total_score + p_penalty),
         updated_at  = now()
   where room_id = p_room_id
     and user_id = any (p_user_ids);
$$;

-- (C) PERFORMANCE — secondary indexes.
--     The live DB has PKs + FKs + unique constraints but almost no secondary
--     indexes. Postgres does NOT auto-index FK columns, so every gameplay and
--     leaderboard query filtering by room_id / user_id / match_id / league_id was
--     doing a sequential scan that degrades linearly as data grows. These turn
--     the hot paths into index lookups. Zero app-code change.
create index if not exists idx_answers_question_event on answers (question_event_id);
create index if not exists idx_answers_user_answered   on answers (user_id, answered_at desc);
create index if not exists idx_answers_room            on answers (room_id);
create index if not exists idx_answers_match           on answers (match_id);
create index if not exists idx_qe_room_seq             on question_events (room_id, sequence_number);
create index if not exists idx_qe_match                on question_events (match_id);
create index if not exists idx_room_scores_room        on room_scores (room_id, total_score desc);
create index if not exists idx_room_members_room       on room_members (room_id);
create index if not exists idx_league_members_user     on league_members (user_id);
create index if not exists idx_profiles_total_score    on profiles (total_score desc);

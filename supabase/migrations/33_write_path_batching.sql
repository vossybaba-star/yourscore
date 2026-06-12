-- 33_write_path_batching.sql
-- Second half of the pre-WC write-load reduction (see 32_io_hardening.sql).
-- Applied to production via Management API on 2026-06-12 and recorded in
-- schema_migrations; this file is the source-of-truth record.

-- 1. draft_live_pair: stop rewriting the queue row on every poll.
--    While searching, each client re-calls this every ~1.5s; the ON CONFLICT
--    update rewrote (and WAL-logged) the row each time just to bump
--    enqueued_at. The WHERE clause skips the write entirely when nothing
--    changed and the heartbeat is <10s old. Semantics preserved: any change to
--    ranked/league/competition still writes immediately, FIFO order still works
--    (enqueued_at advances at 10s granularity), and the cancel/bot-fallback
--    paths still hard-delete the row.
create or replace function draft_live_pair(
  p_user uuid,
  p_ranked boolean,
  p_league uuid,
  p_competition text default 'PL'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_match uuid;
  v_comp text := coalesce(p_competition, 'PL');
begin
  select user_id into v_match
    from draft_live_queue
   where user_id <> p_user
     and ranked = p_ranked
     and league_id is not distinct from p_league
     and competition = v_comp
   order by enqueued_at
   for update skip locked
   limit 1;

  if v_match is not null then
    delete from draft_live_queue where user_id in (v_match, p_user);
    return v_match;
  end if;

  insert into draft_live_queue (user_id, ranked, league_id, competition)
  values (p_user, p_ranked, p_league, v_comp)
  on conflict (user_id) do update
    set enqueued_at = now(),
        ranked = excluded.ranked,
        league_id = excluded.league_id,
        competition = excluded.competition
  where draft_live_queue.enqueued_at < now() - interval '10 seconds'
     or draft_live_queue.ranked is distinct from excluded.ranked
     or draft_live_queue.league_id is distinct from excluded.league_id
     or draft_live_queue.competition is distinct from excluded.competition;
  return null;
end;
$$;

-- 2. record_quiz_results: replaces /api/quiz/complete's per-result UPDATE loop
--    (up to 60 round-trips) + increment_question_stats' double UPDATE (every
--    correct question's row rewritten twice). One call, two statements, one row
--    version per question — the largest burst write path during quiz spikes.
--    Semantics preserved exactly: history rows are only UPDATEd where they
--    already exist for this user, counters get +1 per distinct question id
--    present in the arrays (ANY(), like the old function — duplicates do not
--    multi-increment).
create or replace function record_quiz_results(
  p_user uuid,
  p_qids uuid[],
  p_correct uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update user_question_history h
     set correct = (h.question_id = any(p_correct))
   where h.user_id = p_user
     and h.question_id = any(p_qids);

  update questions q
     set times_answered = times_answered + 1,
         times_correct  = times_correct + (case when q.id = any(p_correct) then 1 else 0 end)
   where q.id = any(p_qids);
end;
$$;

-- Service-role only: the API route derives p_user from the session. Without
-- this, the default PUBLIC execute grant would let any authenticated client
-- rewrite history rows / inflate question counters directly.
revoke execute on function record_quiz_results(uuid, uuid[], uuid[]) from public, anon, authenticated;

-- 224_rooms_answer_key_split.sql
-- Security audit 2026-07-30. `rooms.questions_json` is readable with the public
-- anon key (the play page reads it to render each question), and room/start stored
-- the bank/pack rows verbatim — answer included. Anyone could read the exact answer
-- key, in order, for the game they were about to play:
--     GET /rest/v1/rooms?select=questions_json&questions_json=not.is.null
--
-- The answer key moves to `rooms.answers_json`, which is withheld from anon and
-- authenticated by column grants and only ever read with the service role
-- (/api/answer). See the matching code change in room/start, api/answer and
-- versus/quiz-matchmaking.
--
-- APPLIED IN THREE STEPS so live games never lose grading:
--   A) add answers_json + backfill from the existing snapshots   (already applied)
--   B) deploy the code that writes/reads answers_json            (already deployed)
--   C) strip answers from the stored snapshots + lock the column (this file)
-- Running C before B would have broken grading for in-flight rooms.

-- A) column + backfill (idempotent; already applied ahead of the code deploy).
alter table public.rooms add column if not exists answers_json jsonb;

update public.rooms r
set answers_json = (
  select jsonb_agg(coalesce(e->>'answer', '') order by ord)
  from jsonb_array_elements(r.questions_json) with ordinality as t(e, ord)
)
where r.questions_json is not null
  and jsonb_typeof(r.questions_json) = 'array'
  and r.answers_json is null;

-- C) strip the answer out of every stored snapshot. Safe now: the key is in
--    answers_json and the deployed /api/answer reads it (with a legacy fallback).
update public.rooms r
set questions_json = (
  select jsonb_agg((e - 'answer') order by ord)
  from jsonb_array_elements(r.questions_json) with ordinality as t(e, ord)
)
where r.questions_json is not null
  and jsonb_typeof(r.questions_json) = 'array'
  and r.questions_json::text like '%"answer"%';

-- Lock answers_json away from the public roles. Postgres has no "revoke one
-- column" — a table-level SELECT covers every column, including ones added later
-- — so the table grant is dropped and re-issued per column, minus answers_json.
-- The list is built dynamically so no column is missed.
--
-- NOTE for future work: because this is now a column-level grant, a NEW column on
-- `rooms` is NOT readable by anon/authenticated until it is granted explicitly.
-- That fails safe (a new column is private by default) but will look like an
-- RLS/permission bug if you add a column the client needs — grant it here.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rooms'
    and column_name <> 'answers_json';

  execute 'revoke select on public.rooms from anon, authenticated';
  execute format('grant select (%s) on public.rooms to anon, authenticated', cols);
end $$;

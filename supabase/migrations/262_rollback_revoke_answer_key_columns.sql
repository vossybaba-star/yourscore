-- 262_rollback_revoke_answer_key_columns.sql
-- ROLLBACK for 262_revoke_answer_key_columns.sql. NOT part of the forward
-- migration sequence: apply this by hand only if the sprint-1 deploy has to be
-- reverted and the old client (which reads answer columns straight from the
-- browser) is put back in front of users.
--
-- Restoring these grants re-opens the answer-key exposure documented in 262.
-- Prefer rolling the APPLICATION forward with a fix over running this. If it is
-- run, treat every published pack's key as compromised for the window it was
-- open and plan a question rotation.
--
-- This restores the pre-262 state: a plain table-level SELECT for anon and
-- authenticated, which is what Supabase's default `grant select on all tables`
-- had left in place.

begin;

grant select on public.quiz_packs to anon, authenticated;
grant select on public.questions to anon, authenticated;
grant select on public.quiz_attempts to anon, authenticated;
grant select on public.h2h_challenges to anon, authenticated;

commit;

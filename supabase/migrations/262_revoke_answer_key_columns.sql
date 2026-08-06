-- 262_revoke_answer_key_columns.sql
-- Trust Sprint 1, Priority 1: stop the public keys reaching the database client.
--
-- ⚠️ DO NOT APPLY BEFORE THE SPRINT-1 APPLICATION DEPLOY IS LIVE AND VERIFIED.
-- Applying this against the current production code breaks H2H play, the live
-- match quiz, and the challenge pack pickers, which read these columns straight
-- from the browser with the anon key. Order is: deploy code -> verify -> apply
-- this -> run the security probes. See docs/TRUST-SPRINT-1-ROLLOUT.md.
--
-- What was verified against production before writing this (anon key only):
--   quiz_packs.questions  -> 449 published packs, each question carrying `answer`
--   questions.answer      -> 35,744 rows (3,211 status=active)
--   quiz_attempts.answers -> 2,694 of 2,695 rows, each entry {idx, selected,
--                            correct, points, elapsed_ms}; `selected` + `correct`
--                            reconstructs a played pack's key on its own
--   h2h_challenges.*_answers -> null on every current row, but world-readable by
--                            design once a challenge completes
--
-- WHY GRANT-REBUILD RATHER THAN "REVOKE ONE COLUMN": PostgreSQL has no way to
-- subtract a single column from a table-wide SELECT grant. A table-level grant
-- covers every column, including ones added later. So each table below has its
-- table-level SELECT revoked and then re-granted column by column, omitting the
-- sensitive ones. The consequence to know about: any future column added to
-- these tables is NOT readable by anon/authenticated until it is added to the
-- grant list here. That is the safe default and is the point.
--
-- `service_role` is untouched throughout, so every server route keeps working:
-- grading (/api/quiz/solo-complete, /api/h2h/play, /api/answer), the pack
-- loader, and the admin tools all use createServiceClient().
--
-- RLS policies are deliberately NOT changed by this migration. Row visibility
-- rules stay exactly as they are; this is purely about which COLUMNS a
-- non-service role may read.

begin;

-- ── quiz_packs: everything except `questions` ────────────────────────────────
-- `questions` embeds the answer key inline. Public surfaces need the pack's
-- identity and metadata (name, cover, counts) and nothing else; the play path
-- now goes through /api/challenges/pack, which strips answers server-side.
revoke select on public.quiz_packs from anon, authenticated;
grant select (
  id, type, name, parameter, question_count, created_at, updated_at, title,
  status, source, user_id, tags, difficulty_focus, metadata, rotation_active,
  rotation_order, created_by, is_custom, featured, featured_order, play_count,
  description, release_at, approved_at, approved_by, theme
) on public.quiz_packs to anon, authenticated;

-- ── questions: everything except `answer` ────────────────────────────────────
-- Question text and options stay readable so any surface rendering a question
-- keeps working; only the key is withheld. Grading reads it via service_role.
revoke select on public.questions from anon, authenticated;
grant select (
  id, entity, entity_type, question, options, difficulty, category, era, tags,
  status, source_pack_id, created_at, times_answered, times_correct,
  verification_note, source, fact_key
) on public.questions to anon, authenticated;

-- ── quiz_attempts: everything except `answers` ───────────────────────────────
-- The leaderboard use case (who scored what on which pack) is fully served by
-- the columns below. `answers` is the per-question {selected, correct} log,
-- which is the sharpest reconstruction path and has no client-side use: the
-- one server surface that needs it (the pace stat on your own profile) is
-- moved onto the service client in this same sprint.
revoke select on public.quiz_attempts from anon, authenticated;
grant select (
  id, user_id, pack_id, score, max_score, correct_count, completed_at, source,
  utm_source, utm_medium, utm_campaign
) on public.quiz_attempts to anon, authenticated;

-- ── h2h_challenges: everything except the two answer logs ────────────────────
-- This table is public-read BY DESIGN so a share link works for a signed-out
-- viewer (see migration 259's note), and that stays true. Only the per-question
-- pick logs are withheld; the post-completion review UI now reads them through
-- GET /api/h2h/[id]/questions, which checks participation server-side.
revoke select on public.h2h_challenges from anon, authenticated;
grant select (
  id, quiz_pack_id, quiz_pack_name, challenger_id, challenger_name,
  challenger_score, challenger_correct, total_questions, max_score, opponent_id,
  opponent_score, opponent_correct, created_at, expires_at, invited_user_id,
  status, seen_by_opponent, mode, game, duel_id
) on public.h2h_challenges to anon, authenticated;

commit;

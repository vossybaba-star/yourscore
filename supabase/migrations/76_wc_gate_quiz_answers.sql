-- 76: persist the WC Mastermind gate quiz per-question detail on the run row.
-- The server already re-derives the day's questions and grades the answers at
-- submit (rankedQuizScore); this stores what it graded so the content pipeline
-- (Question Guru, hard-question stats) can mine Mastermind players — the
-- biggest daily player pool — instead of quiz surfaces alone.
--
-- Shape: jsonb array, one element per gate question, pack-compatible:
--   { "question": text, "options": {"A": text, ...}, "answer": "B",
--     "category": text, "selected": "C" | null, "correct": bool }
-- Options/letters are deterministic per date (same-test rule), so grouping by
-- the question object aggregates cleanly across players.

ALTER TABLE public.draft_wc_runs
  ADD COLUMN IF NOT EXISTS quiz_answers jsonb;

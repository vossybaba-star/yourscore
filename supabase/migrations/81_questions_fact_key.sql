-- Track which FACT each question was built from, so the draw never deals two questions
-- from the same fact in one quiz.
--
-- Why: the factory is facts-first — it researches verified facts, then writes several
-- questions from each. That's deliberate (founder's call: volume beats purity when building
-- a bank). But two questions off the same fact can spoil each other:
--
--   "Which club did Arsenal beat in the 2019/20 FA Cup final?"            → Chelsea
--   "Who scored both goals in Arsenal's 2019/20 final win OVER CHELSEA?"  → hands it to you
--
-- The existing guards can't catch this: the dedupe index compares question TEXT, and those
-- two texts are entirely different. So the fix belongs at serve time, not generation time —
-- keep the questions, just never put related ones in the same quiz.
--
-- fact_key is a stable hash of the source fact, assigned by the factory at author time.
-- NULL for every pre-existing row: legacy questions weren't built from a tracked fact, so
-- they're treated as unrelated to everything (which is what they are).

alter table questions
  add column if not exists fact_key text;

comment on column questions.fact_key is
  'Stable hash of the source fact this question was built from (quiz factory). Questions sharing a fact_key must never be dealt in the same quiz — they can spoil each other. NULL = legacy/untracked, treated as unrelated.';

-- The draw filters by entity + difficulty and then needs fact_key to group on. Partial:
-- only factory-built rows have one.
create index if not exists questions_fact_key_idx
  on questions (fact_key)
  where fact_key is not null;

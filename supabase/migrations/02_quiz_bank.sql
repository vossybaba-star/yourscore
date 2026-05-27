-- Add aggregate stats columns to questions table
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS times_answered integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS times_correct  integer NOT NULL DEFAULT 0;

-- Track which questions each user has seen + whether they got it right
CREATE TABLE IF NOT EXISTS user_question_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  entity      text NOT NULL,
  correct     boolean,
  played_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_uqh_user_entity ON user_question_history(user_id, entity);
CREATE INDEX IF NOT EXISTS idx_uqh_question    ON user_question_history(question_id);

-- RLS: users can only read/write their own history
ALTER TABLE user_question_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own history" ON user_question_history
  FOR ALL USING (auth.uid() = user_id);

-- Atomic counter increment (avoids race conditions in quiz/complete)
CREATE OR REPLACE FUNCTION increment_question_stats(
  question_ids uuid[],
  correct_ids  uuid[]
) RETURNS void AS $$
BEGIN
  UPDATE questions SET times_answered = times_answered + 1 WHERE id = ANY(question_ids);
  UPDATE questions SET times_correct  = times_correct  + 1 WHERE id = ANY(correct_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

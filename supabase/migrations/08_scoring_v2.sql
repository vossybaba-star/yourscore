-- Scoring engine v2: wrong_streak needed for comeback bonus tracking

ALTER TABLE room_scores
  ADD COLUMN IF NOT EXISTS wrong_streak INT NOT NULL DEFAULT 0;

-- match_scores keeps the same shape for live-match play
ALTER TABLE match_scores
  ADD COLUMN IF NOT EXISTS wrong_streak INT NOT NULL DEFAULT 0;

-- Track per-player avg and fastest answer speed in each lobby
ALTER TABLE room_scores ADD COLUMN IF NOT EXISTS avg_answer_speed_ms INT;
ALTER TABLE room_scores ADD COLUMN IF NOT EXISTS fastest_answer_ms INT;

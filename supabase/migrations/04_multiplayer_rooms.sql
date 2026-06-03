-- Multiplayer game rooms: player-created lobbies with Kahoot-style sync

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS room_mode         text NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS question_count    int  NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS pack_id           uuid,
  ADD COLUMN IF NOT EXISTS category_filter   text,
  ADD COLUMN IF NOT EXISTS difficulty_filter text NOT NULL DEFAULT 'mixed',
  ADD COLUMN IF NOT EXISTS questions_json    jsonb,
  ADD COLUMN IF NOT EXISTS current_question_idx int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS question_started_at  timestamptz;

-- Extend type to allow player-created rooms
-- (column is text so no ALTER TYPE needed, just update default on new inserts)

-- RLS for rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any, then recreate
DROP POLICY IF EXISTS "Anyone can read player rooms" ON rooms;
DROP POLICY IF EXISTS "Auth users create rooms" ON rooms;
DROP POLICY IF EXISTS "Host can update own room" ON rooms;

CREATE POLICY "Anyone can read player rooms" ON rooms
  FOR SELECT USING (true);

CREATE POLICY "Auth users create rooms" ON rooms
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Host can update own room" ON rooms
  FOR UPDATE USING (auth.uid() = created_by);

-- RLS for room_members
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own room" ON room_members;
DROP POLICY IF EXISTS "Auth users join rooms" ON room_members;
DROP POLICY IF EXISTS "Auth users leave rooms" ON room_members;

CREATE POLICY "Members read own room" ON room_members
  FOR SELECT USING (true);

CREATE POLICY "Auth users join rooms" ON room_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_rooms_code   ON rooms (code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms (status);
CREATE INDEX IF NOT EXISTS idx_rooms_mode   ON rooms (room_mode);

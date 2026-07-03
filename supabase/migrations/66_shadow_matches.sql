-- Shadow matches: play the ghost of a real player's previous multiplayer run.
-- ADDITIVE. One column + one index:
--   rooms.shadow — set only on shadow Lobbies. Shape:
--     { "userId": uuid,          -- whose run is being replayed (identity, revealed at the end)
--       "name": text,            -- denormalized persona for zero-fetch rendering
--       "avatarUrl": text|null,
--       "sourceRoomId": uuid,    -- the completed room the run came from (questions copied verbatim)
--       "times": int[],          -- per-question time_taken_ms by sequence — client presence tick only
--       "originalScore": int }   -- their score in the source run (honest-reveal copy)
--   The replay itself is written under the CPU seat (QUIZ_BOT_ID) via /api/answer,
--   so the shadow owner's own stats are never touched.

begin;

alter table rooms add column if not exists shadow jsonb;

-- Pool queries: "recent completed runs on this pack" (findShadowRun).
create index if not exists rooms_completed_pack_idx
  on rooms (pack_id, created_at desc) where status = 'completed';

commit;

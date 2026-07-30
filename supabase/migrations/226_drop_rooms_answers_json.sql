-- 226_drop_rooms_answers_json.sql
-- Final step of the room answer-key split (224 → 225 → 226).
--
-- `rooms.answers_json` was the interim home for the key. It is now redundant:
-- every key lives in `room_answers` (service-role only), and no code reads or
-- writes the column any more — room/start, /api/answer and versus/quiz-matchmaking
-- were all pointed at `room_answers` and deployed before this ran.
--
-- Dropping it is what finally removes the key from `rooms`, which the anon key can
-- read. With the column gone there is nothing sensitive left on the table, so
-- `rooms` keeps its ordinary table-level SELECT and `select("*")` from the play
-- page keeps working — no column grants, no trap for the next change.
--
-- Verified before running: 400/400 rooms carrying a question snapshot have their
-- key in room_answers, and `git grep answers_json src/` on the deployed branch
-- returns nothing.

alter table public.rooms drop column if exists answers_json;

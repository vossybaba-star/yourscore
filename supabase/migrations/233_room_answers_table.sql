-- 225_room_answers_table.sql
-- Follow-up to 224. Moves the per-room answer key OFF the `rooms` table entirely.
--
-- WHY: 224 kept the key in `rooms.answers_json` and hid it with COLUMN-level
-- grants. That broke the live game — the play page does
-- `from("rooms").select("*")`, and PostgREST expands `*` to every column, so a
-- single ungranted column 401s the whole query. Column grants on a table the
-- client reads with `*` are a trap; a separate table with no grant at all is not.
--
-- `room_answers` is service-role only: RLS on with no policy (deny-all) and no
-- grants to anon/authenticated. `rooms` keeps its plain table-level SELECT, so
-- `select("*")` works forever and new columns on `rooms` behave normally.
--
-- Sequenced so grading never breaks:
--   A) create + copy from rooms.answers_json   (this file, non-breaking)
--   B) deploy code that writes/reads room_answers, falling back to answers_json
--   C) drop rooms.answers_json                 (migration 226, after B is live)

create table if not exists public.room_answers (
  room_id    uuid primary key references public.rooms(id) on delete cascade,
  answers    jsonb not null,
  created_at timestamptz not null default now()
);

-- Deny-all for the public roles: RLS on with no policy, and no grants issued.
-- Only the service role (which bypasses RLS) can read or write this.
alter table public.room_answers enable row level security;
revoke all on table public.room_answers from anon, authenticated;
grant select, insert, update, delete on table public.room_answers to service_role;

-- Carry over the keys written by migration 224 / the current code.
insert into public.room_answers (room_id, answers)
select r.id, r.answers_json
from public.rooms r
where r.answers_json is not null
on conflict (room_id) do update set answers = excluded.answers;

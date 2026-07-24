-- "Today's Game" — one featured game per calendar day (Europe/London), the
-- same for every player so scores are comparable. This table is the
-- SCHEDULE only: fill-schedule.mjs writes rows ahead of time following the
-- fixed week shape (see src/lib/daily-game.ts). A missing row for today is
-- not an error — src/lib/daily-game.ts falls back to the featured pack so
-- the home hero is never empty or broken.
--
-- pack_id is only meaningful for game_type='quiz' (references quiz_packs).
-- Perfect 10 already gates its own "today's list" by day
-- (src/lib/games/perfect10.ts loadListForDay) — this table does not
-- override that. Higher or Lower / Guess the Player are pinned by date at
-- serve time instead (dailySeed in src/lib/games/serve.ts, reached via the
-- ?daily=1 href), so a Friday round is identical for every player without
-- needing a row here.
--
-- Public read: this is just a schedule (which game type plays which day),
-- not sensitive — the home page reads it for both signed-in and signed-out
-- visitors. Writes are service-role only (fill-schedule.mjs / founder
-- overrides), never client-writable.

create table if not exists public.daily_games (
  day         date primary key,
  game_type   text not null check (game_type in ('quiz', 'perfect-10', 'higher-lower', 'guess-the-player')),
  pack_id     uuid null references public.quiz_packs(id),
  source      text not null default 'auto' check (source in ('auto', 'override')),
  created_at  timestamptz not null default now()
);

alter table public.daily_games enable row level security;

revoke all on public.daily_games from anon, authenticated;
grant select on public.daily_games to anon, authenticated;

create policy "daily_games public read" on public.daily_games for select using (true);

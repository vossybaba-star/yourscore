-- The Daily Briefing — the day's five biggest Premier League stories, as links.
--
-- One row per day, keyed by the LONDON date (not the server's): the briefing is
-- named after the day its readers are having. Keyed by date rather than a single
-- mutable row so yesterday's briefing survives — a reader who opens it at 00:05
-- should not find it already replaced, and history costs nothing.
--
-- The doc holds the compiled subhead, one bullet per story, and the five source
-- articles with their own thumbnails and links. We publish no reporting of our
-- own; see src/lib/pl/briefingBuild.ts for the grounding guard that enforces it.
begin;

create table if not exists pl_briefings (
  date       date primary key,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);

-- Public read: the briefing is the same for everyone and is served to signed-out
-- readers too. Writes are service-role only (the cron), which bypasses RLS.
alter table pl_briefings enable row level security;
drop policy if exists "pl_briefings_read" on pl_briefings;
create policy "pl_briefings_read" on pl_briefings for select to public using (true);

commit;

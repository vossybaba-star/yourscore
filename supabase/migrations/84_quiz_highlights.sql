-- Quiz "how fans did" stat highlights (Matchweek → Live Quiz).
--
-- Singleton doc (id = 1): a job aggregates quiz_attempts answer distributions
-- and writes the few most-interesting questions (biggest split, most-missed)
-- as jsonb. /api/pl/quiz-highlights reads it. Same singleton-doc pattern as
-- pl_news_feed (migration 83).
--
-- NOTE (numbering): see 83_pl_news.sql — re-check the number at merge time.

create table if not exists public.quiz_highlights (
  id          smallint primary key default 1,
  doc         jsonb not null default '{"items":[],"updatedAt":null}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint quiz_highlights_singleton check (id = 1)
);

-- Read via the service-role client (bypasses RLS). Deny-all otherwise.
alter table public.quiz_highlights enable row level security;
revoke all on public.quiz_highlights from public;

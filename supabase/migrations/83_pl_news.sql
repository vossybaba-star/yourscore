-- PL general-news feed (Matchweek → PL → News).
--
-- Singleton doc: ONE row (id = 1) holding the whole aggregated feed as jsonb,
-- overwritten every ~20 min by the RSS ingest (scripts/pl-news-ingest.mjs).
-- A single-row upsert is all the write path needs and all the read path reads,
-- so there is no per-article table to index or vacuum.
--
-- NOTE (migration numbering): 77/78/79/80 are taken on prod by the parallel
-- fantasy + quiz-content-factory work; this file is 83 to sit above the
-- halftime (80) / club-fans (81) / predictions (82) migrations on this branch.
-- Re-check the number at merge time.

create table if not exists public.pl_news_feed (
  id          smallint primary key default 1,
  doc         jsonb not null default '{"items":[],"updatedAt":null}'::jsonb,
  updated_at  timestamptz not null default now(),
  -- Enforce the singleton: only id = 1 may ever exist.
  constraint pl_news_feed_singleton check (id = 1)
);

-- Read path is the public /api/pl/news route via the service-role client, which
-- bypasses RLS. Enable RLS with NO policies so nothing else can read/write it
-- (deny-all), matching the halftime tables' posture.
alter table public.pl_news_feed enable row level security;

-- The ingest writes with the service role; no grants to anon/authenticated.
revoke all on public.pl_news_feed from public;

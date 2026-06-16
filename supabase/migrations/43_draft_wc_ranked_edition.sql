-- 43_draft_wc_ranked_edition.sql
-- The ranked World Cup daily no longer auto-rolls at UTC midnight. Instead it keys off an
-- "active edition" pointer: the latest run stays available to everyone who hasn't played it
-- UNTIL a new edition is posted (rolled as part of the daily quiz launch). Posting a new
-- edition resets the one-go for everyone. A delayed launch just means the old edition stays
-- live longer.
--
-- Singleton config row (id=true). Server-only (service role); RLS on with no policies.

begin;

create table if not exists wc_ranked_edition (
  id           boolean     primary key default true,
  edition      text        not null,   -- the active edition key (a YYYY-MM-DD date string)
  published_at timestamptz not null default now(),
  constraint wc_ranked_edition_one_row check (id)
);

alter table wc_ranked_edition enable row level security;

-- Seed with today's UTC date so the edition is pinned from the start (a clean handover from
-- the old date-based keying — runs already played today share this edition key).
insert into wc_ranked_edition (id, edition)
  values (true, to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
  on conflict (id) do nothing;

commit;

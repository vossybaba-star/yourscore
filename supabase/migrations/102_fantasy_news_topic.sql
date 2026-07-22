-- Fantasy news hub: give each news item a TOPIC.
--
-- Without this, the feed builder pulled the same rows into BOTH the "Team news"
-- and "Transfers & talk" sections (they queried one untyped table), so every
-- item rendered twice. Topic is what lets a section mean something.
--
-- Also adds a dedupe key: the ingester runs hourly against the same X accounts
-- and RSS feeds, so the same tweet/article WILL be seen again. One persistent
-- unique key per source item is the only thing that stops the feed filling with
-- duplicates (LOOP-STANDARD rule 4).

begin;

alter table fantasy_news_items
  add column if not exists topic text not null default 'general'
    check (topic in ('team-news', 'transfer', 'general'));

-- Stable identity of the SOURCE item (tweet id, article guid/url) — not the row.
alter table fantasy_news_items
  add column if not exists source_key text;

create unique index if not exists fantasy_news_items_source_key_uidx
  on fantasy_news_items (source_key)
  where source_key is not null;

create index if not exists fantasy_news_items_topic_created_idx
  on fantasy_news_items (topic, created_at desc);

commit;

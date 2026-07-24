-- Fantasy news & insights hub (docs/fantasy-news-hub-spec.md).
-- Feed is GENERAL (same for all users) and built by cron — users only read.
begin;

-- One feed document per gameweek (keyed by gw, not a single mutable row:
-- history for free + next GW can build while current is live).
create table if not exists fantasy_news_feed (
  gw         int primary key,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
alter table fantasy_news_feed enable row level security;
drop policy if exists "fantasy_news_feed_read" on fantasy_news_feed;
create policy "fantasy_news_feed_read" on fantasy_news_feed for select to public using (true);

-- Predicted-XI snapshots. The "dropped from XI = likely doubt" inference
-- diffs the latest two snapshots per club — a single feed doc can't do that.
create table if not exists fantasy_predicted_xi (
  gw         int not null,
  club_id    int not null,          -- SportMonks team id
  xi         jsonb not null,        -- [{smId, name}]
  fetched_at timestamptz not null default now(),
  primary key (gw, club_id, fetched_at)
);
alter table fantasy_predicted_xi enable row level security;
drop policy if exists "fantasy_predicted_xi_read" on fantasy_predicted_xi;
create policy "fantasy_predicted_xi_read" on fantasy_predicted_xi for select to public using (true);

-- Curated editorial/tweet items POSTed by the VPS content pipeline
-- (POST /api/fantasy/news-items, bearer auth). Tweets store text/author/image
-- at ingest so we render native cards — never X's widgets.js.
create table if not exists fantasy_news_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('article', 'tweet')),
  payload    jsonb not null,        -- article: {title,url,image?,source} · tweet: {text,author,handle,url,image?}
  created_at timestamptz not null default now()
);
create index if not exists fantasy_news_items_created_idx on fantasy_news_items (created_at desc);
alter table fantasy_news_items enable row level security;
drop policy if exists "fantasy_news_items_read" on fantasy_news_items;
create policy "fantasy_news_items_read" on fantasy_news_items for select to public using (true);

commit;

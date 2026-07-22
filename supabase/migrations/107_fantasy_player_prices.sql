-- 83_fantasy_player_prices.sql — the weekly price snapshot (design §7, founder-locked 14 Jul).
--
-- Prices track FPL and change weekly. They CANNOT live in src/data/fantasy/pool.json:
-- that file is a static import, frozen into the build, so moving a price would mean
-- a redeploy — tying the game's economy to shipping code.
--
-- One row per (gameweek, player). Taken ONCE at gameweek open and frozen for the
-- week: your transfer on Saturday costs what it cost on Tuesday. That is the whole
-- point — we keep FPL's price economy and delete its nightly price-watching chore.
--
-- Keyed by gw so the snapshot is history: a locked entry can always be re-priced
-- against the prices that were true when it was played.
begin;

create table if not exists fantasy_player_prices (
  gw           int not null,
  player_id    int not null,          -- pool id (= FPL element id)
  price_tenths int not null,          -- FPL's now_cost IS tenths — no conversion
  updated_at   timestamptz not null default now(),
  primary key (gw, player_id)
);

alter table fantasy_player_prices enable row level security;
drop policy if exists "fantasy_player_prices_read" on fantasy_player_prices;
create policy "fantasy_player_prices_read" on fantasy_player_prices
  for select to public using (true);
-- No write policies: service-role only, like every other fantasy write.

commit;

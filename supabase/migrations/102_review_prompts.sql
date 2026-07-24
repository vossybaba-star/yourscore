-- 102 — review_prompts: a server-side record of every rating ask we make.
--
-- Until now the post-game rate ask was gated purely by a localStorage stamp,
-- so it left no trace anywhere: we could not answer "how many review requests
-- have we made?" at all, on any surface, ever. Ratings were a numerator with no
-- denominator. This table is the denominator.
--
-- One row per ask SHOWN (not per eligibility check), plus the outcome once the
-- player acts on it.
--
--   surface  where the ask came from — 'post-game' | 'wc-thanks'
--   variant  what they actually saw:
--              'native'   Apple's inline star popup (SKStoreReviewController)
--              'card'     our soft card linking to the write-review page
--              'download' the web-iPhone "get the app" nudge (not a review ask,
--                         logged here so the whole prompt surface is countable)
--   outcome  null = shown only · 'acted' · 'dismissed'
--
-- CAVEAT worth writing down: a 'native' row means we CALLED requestReview, not
-- that Apple drew anything. Apple caps the popup at 3 per user per 365 days and
-- silently no-ops past that, with no error and no callback. We now enforce that
-- same cap ourselves (see /api/review-prompt) precisely so a 'native' row is
-- honest — past the cap we serve the card instead of burning an invisible ask.

create table if not exists review_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  surface text not null check (surface in ('post-game', 'wc-thanks')),
  variant text not null check (variant in ('native', 'card', 'download')),
  outcome text check (outcome in ('acted', 'dismissed')),
  created_at timestamptz not null default now()
);

-- Eligibility reads are always "this user's recent asks", newest first.
create index if not exists review_prompts_user_recent_idx
  on review_prompts (user_id, created_at desc);

-- Write-only mailbox, same shape as product_feedback: a player may record their
-- own asks, but nobody reads this over the anon/authed API. All reads go through
-- the service role in /api/review-prompt.
alter table review_prompts enable row level security;

drop policy if exists review_prompts_insert_own on review_prompts;
create policy review_prompts_insert_own on review_prompts
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Backfill what we CAN account for: the WC campaign asks are the only ones ever
-- stamped server-side, so they are the only history that exists.
insert into review_prompts (user_id, surface, variant, created_at)
select user_id, 'wc-thanks', 'card', review_done_at
from wc_thanks_prompts
where review_done_at is not null
  and review_done_at > created_at   -- excludes the 94 pre-stamped at seed time
on conflict do nothing;

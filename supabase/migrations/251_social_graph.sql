-- 251_social_graph.sql — Social Phase 3b: bookmarks + a pinned post.
--
-- fantasy_feed_bookmarks is a PRIVATE per-user save list layered on top of the
-- public feed (fantasy_feed_events, migrations 226/243). Unlike user_follows
-- (migration 225, a public graph anyone can read) a bookmark is nobody's
-- business but the saver's — RLS is OWN-ROW ONLY for select/insert/delete,
-- keyed (event_id, user_id) so a save is idempotent per post per user.
--
-- profiles.pinned_event_id holds at most one pinned post per profile, shown
-- above their Posts tab. Deliberately no FK to fantasy_feed_events: the
-- pinned post can be deleted later, and ownership/existence are re-checked in
-- code at write time (lib/fantasy/feed.ts's pinPost) — the same pattern
-- fantasy_feed_events.payload->>repostOf already uses instead of a DB
-- constraint, since payload is jsonb and can't carry one anyway.
--
-- Written but NOT applied here (reviewer applies at ship time) — every read/
-- write this migration enables is wrapped so the app degrades gracefully
-- while it's absent (bookmark APIs 503, pin controls hidden, myBookmarked
-- false), same discipline as migration 250 (link_previews).

begin;

create table if not exists public.fantasy_feed_bookmarks (
  event_id   uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists fantasy_feed_bookmarks_user_idx
  on public.fantasy_feed_bookmarks (user_id, created_at desc);

alter table public.fantasy_feed_bookmarks enable row level security;

drop policy if exists fantasy_feed_bookmarks_select on public.fantasy_feed_bookmarks;
create policy fantasy_feed_bookmarks_select on public.fantasy_feed_bookmarks
  for select to authenticated using (user_id = auth.uid());

drop policy if exists fantasy_feed_bookmarks_insert on public.fantasy_feed_bookmarks;
create policy fantasy_feed_bookmarks_insert on public.fantasy_feed_bookmarks
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists fantasy_feed_bookmarks_delete on public.fantasy_feed_bookmarks;
create policy fantasy_feed_bookmarks_delete on public.fantasy_feed_bookmarks
  for delete to authenticated using (user_id = auth.uid());
-- NO update policy: a bookmark is created or removed, never edited in place.

alter table public.profiles add column if not exists pinned_event_id uuid;

commit;

-- 226_fantasy_feed.sql
-- The fantasy activity feed — interesting moves by other managers, with
-- like / comment / reply reactions. Two tabs are read off this: "Following"
-- (moves by people you follow, mig 225) and "Global" (everyone).
--
-- Events are emitted server-side at the moment a move happens (transfer, chip)
-- or is settled (big gameweek haul, big rank jump), so this table is written by
-- the service role only; reads are public to any signed-in user.

create table if not exists public.fantasy_feed_events (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null,
  type       text not null check (type in ('transfer','captain','chip','haul','rank_jump')),
  gw         int,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fantasy_feed_created_idx on public.fantasy_feed_events (created_at desc);
create index if not exists fantasy_feed_actor_idx   on public.fantasy_feed_events (actor_id, created_at desc);

alter table public.fantasy_feed_events enable row level security;

drop policy if exists fantasy_feed_select on public.fantasy_feed_events;
create policy fantasy_feed_select on public.fantasy_feed_events
  for select to authenticated using (true);

-- Event-level likes (the "like this move" heart). Comments/replies reuse the
-- existing comments stack via the subject type below; this is the like on the
-- event itself. Mirrors comment_likes: composite PK, self-write, no public read
-- (the feed API aggregates counts via the service role).
create table if not exists public.fantasy_feed_likes (
  event_id uuid not null references public.fantasy_feed_events(id) on delete cascade,
  user_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists fantasy_feed_likes_event_idx on public.fantasy_feed_likes (event_id);

alter table public.fantasy_feed_likes enable row level security;

drop policy if exists fantasy_feed_likes_insert on public.fantasy_feed_likes;
create policy fantasy_feed_likes_insert on public.fantasy_feed_likes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists fantasy_feed_likes_delete on public.fantasy_feed_likes;
create policy fantasy_feed_likes_delete on public.fantasy_feed_likes
  for delete to authenticated using (user_id = auth.uid());

-- Let discussion threads hang off feed events (comments/replies reuse the
-- existing comments table + API). subject_id is a uuid, which fits the event id.
alter table public.comments drop constraint if exists comments_subject_type_check;
alter table public.comments add constraint comments_subject_type_check
  check (subject_type = any (array['pack','debate','fantasy_league','fantasy_feed']));

-- 267_content_feed_interactions.sql — likes + comments on the live content feed.
--
-- The content feed (news + video, /api/feed/live) is external RSS with no rows of
-- its own. Founder (8 Aug): every feed item should be a place to comment, like
-- and interact "just like the X feed". We give each item a STABLE synthetic uuid
-- (a salted SHA-1 of its item id, computed in code — see contentSubjectId in
-- src/lib/rss.ts), so comments and reactions can hang off it with NO ingestion
-- table and no cron: the same external item always maps to the same subject.
--
-- Comments reuse the polymorphic `comments` table + /api/comments. We only need
-- to (a) allow a new subject_type 'content', and (b) add a subject-level emoji
-- reaction table (comment_reactions is keyed to a comment_id, not the item).

begin;

-- (a) Allow 'content' comment threads. Read stays public via the comments read
-- policy's `else true` branch (mig 261) — content is public news, matching
-- pack/debate. Insert already requires auth.uid() = user_id, so posting is
-- signed-in only with no extra policy.
alter table public.comments drop constraint if exists comments_subject_type_check;
alter table public.comments add constraint comments_subject_type_check
  check (subject_type = any (array['pack','debate','fantasy_league','fantasy_feed','content']));

-- (b) Subject-level emoji reactions on a content item. ONE reaction per user per
-- item (PK (subject_id, user_id)), switchable — mirrors fantasy_feed_likes, not
-- comment_reactions (which allows several emoji per user). subject_id is the
-- synthetic content uuid; there is no FK because the item lives outside the DB.
create table if not exists content_reactions (
  subject_id uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (subject_id, user_id)
);

create index if not exists content_reactions_subject_idx on content_reactions (subject_id);

alter table content_reactions enable row level security;

-- Reads are public: content commentary is a public surface, and the counts drive
-- social proof for signed-out visitors.
drop policy if exists "content reactions read" on content_reactions;
create policy "content reactions read" on content_reactions
  for select using (true);

-- Write / switch / clear only your own reaction. Upsert (POST switching emoji)
-- needs both insert and update.
drop policy if exists "content reactions insert own" on content_reactions;
create policy "content reactions insert own" on content_reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "content reactions update own" on content_reactions;
create policy "content reactions update own" on content_reactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "content reactions delete own" on content_reactions;
create policy "content reactions delete own" on content_reactions
  for delete using (auth.uid() = user_id);

commit;

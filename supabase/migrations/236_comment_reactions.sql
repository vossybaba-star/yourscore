-- 236_comment_reactions.sql — emoji reactions on comments, for league chat.
--
-- League chat rides the polymorphic `comments` table (mig 209). This adds emoji
-- reactions on those messages: the founder wants the full set (😂👀🔥👏❤️😭),
-- not just the single heart-like the comment layer had.
--
-- One row per (comment, user, emoji): a user can react with several different
-- emoji to a message, but only once with each. Same privacy shape as the
-- comments themselves — a reaction on a private league message is readable and
-- writable ONLY by that league's members, enforced at the DB so the RLS holds
-- against raw REST, not just the API (which uses the service role and re-checks
-- membership in the chat lib anyway).

begin;

create table if not exists comment_reactions (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);

create index if not exists comment_reactions_comment_idx on comment_reactions (comment_id);

alter table comment_reactions enable row level security;

-- Read a reaction only if you can read the comment it's on: public subject types
-- stay public; a fantasy_league message is members-only.
drop policy if exists "reactions read" on comment_reactions;
create policy "reactions read" on comment_reactions
  for select using (
    exists (
      select 1 from comments c
      where c.id = comment_reactions.comment_id
        and c.deleted_at is null
        and (
          c.subject_type <> 'fantasy_league'
          or exists (
            select 1 from fantasy_league_members m
            where m.league_id = c.subject_id and m.user_id = auth.uid()
          )
        )
    )
  );

-- Write your own reaction, and only onto a comment you're allowed to read.
drop policy if exists "reactions insert own" on comment_reactions;
create policy "reactions insert own" on comment_reactions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from comments c
      where c.id = comment_reactions.comment_id
        and c.deleted_at is null
        and (
          c.subject_type <> 'fantasy_league'
          or exists (
            select 1 from fantasy_league_members m
            where m.league_id = c.subject_id and m.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "reactions delete own" on comment_reactions;
create policy "reactions delete own" on comment_reactions
  for delete using (auth.uid() = user_id);

commit;

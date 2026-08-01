-- 237_league_structured_messages.sql — structured league-chat messages (Phase 1b).
--
-- League chat rides `comments` (text body). This adds two structured message
-- kinds so members can drop a PLAYER card or a POLL into the conversation:
--
--   kind='text'   (default) — an ordinary message, body is the text. Unchanged.
--   kind='player' — payload {playerId, note?}; the card is resolved from the pool.
--   kind='poll'   — payload {question, options:[...]}; votes live in a side table.
--
-- `kind` + `payload` are added to comments as nullable/defaulted columns, so every
-- existing comment (pack/debate/feed/league) is untouched — they're all 'text'.
-- Only league chat ever writes the new kinds today.

begin;

alter table comments add column if not exists kind    text not null default 'text';
alter table comments add column if not exists payload jsonb;

-- Poll votes: one vote per member per poll, changeable (update the option).
create table if not exists comment_poll_votes (
  comment_id   uuid not null references comments(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  option_index int  not null,
  created_at   timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_poll_votes_comment_idx on comment_poll_votes (comment_id);

alter table comment_poll_votes enable row level security;

-- Same privacy shape as the messages: a vote on a league poll is readable and
-- writable only by that league's members (holds against raw REST).
drop policy if exists "poll votes read" on comment_poll_votes;
create policy "poll votes read" on comment_poll_votes
  for select using (
    exists (
      select 1 from comments c
      where c.id = comment_poll_votes.comment_id and c.deleted_at is null
        and (
          c.subject_type <> 'fantasy_league'
          or exists (select 1 from fantasy_league_members m where m.league_id = c.subject_id and m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "poll votes write own" on comment_poll_votes;
create policy "poll votes write own" on comment_poll_votes
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from comments c
      where c.id = comment_poll_votes.comment_id and c.deleted_at is null
        and (
          c.subject_type <> 'fantasy_league'
          or exists (select 1 from fantasy_league_members m where m.league_id = c.subject_id and m.user_id = auth.uid())
        )
    )
  );

commit;

-- 85_fantasy_league_chat.sql — league banter on the existing comments rails.
--
-- The design's launch commitment (D:105-107): a chat/wall per friend league.
-- Reuses the polymorphic comments table (subject_type + subject_id) that already
-- carries quiz-pack and debate threads — same 280-char body, same soft delete.
--
-- THE ONE THING THAT'S DIFFERENT: pack/debate threads are public by design;
-- a league's chat is PRIVATE to its members. That has to hold at the DATABASE,
-- not just in the API — the comments table carries client RLS policies, so
-- without the guard below, anyone with the anon key could read (and write to)
-- any private league's banter over raw REST.
--
-- Also adds the stakes line (D:105-107 "stakes/forfeit tracker", v1): one
-- owner-set sentence pinned above the chat — "loser buys the kebabs".
begin;

-- widen the polymorphic check to the new subject type
alter table comments drop constraint if exists comments_subject_type_check;
alter table comments add constraint comments_subject_type_check
  check (subject_type in ('pack', 'debate', 'fantasy_league'));

-- reads: public threads stay public; league chat is members-only
drop policy if exists "comments read" on comments;
create policy "comments read" on comments
  for select using (
    deleted_at is null
    and (
      subject_type <> 'fantasy_league'
      or exists (
        select 1 from fantasy_league_members m
        where m.league_id = comments.subject_id and m.user_id = auth.uid()
      )
    )
  );

-- writes: own-row, and into a league thread only if you're a member of it
drop policy if exists "comments insert own" on comments;
create policy "comments insert own" on comments
  for insert with check (
    auth.uid() = user_id
    and (
      subject_type <> 'fantasy_league'
      or exists (
        select 1 from fantasy_league_members m
        where m.league_id = comments.subject_id and m.user_id = auth.uid()
      )
    )
  );

-- the stakes line — owner-set, shown pinned above the chat
alter table fantasy_leagues
  add column if not exists stakes text;

commit;

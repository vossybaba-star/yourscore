-- 240_fantasy_feed_reactions.sql
-- Emoji reactions on feed items (founder, 3 Aug). The feed's single "like" heart
-- becomes a small reaction bar — the same six-emoji set the league chat uses
-- (😂 👀 🔥 👏 ❤️ 😭). One reaction per user per event (the PK stays
-- (event_id, user_id)); tapping a different emoji changes it, tapping your own
-- clears it. Additive: existing likes carry over as ❤️ via the column default,
-- so no engagement is lost and nothing needs a backfill.

alter table public.fantasy_feed_likes
  add column if not exists emoji text not null default '❤️';

-- Changing your reaction is an UPDATE (upsert on the composite PK). The table had
-- insert + delete self-write policies; add the matching update policy so raw REST
-- stays as locked-down as the insert/delete paths already are.
drop policy if exists fantasy_feed_likes_update on public.fantasy_feed_likes;
create policy fantasy_feed_likes_update on public.fantasy_feed_likes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

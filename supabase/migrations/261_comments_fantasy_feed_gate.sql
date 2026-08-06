-- 261_comments_fantasy_feed_gate.sql
-- Trust Sprint 1, Priority 2: close the anon read hole on Social post comments.
--
-- How it got here: migration 70 created "comments read" with NO role clause, so
-- it applies to `public` (anon + authenticated). Migration 209 added a
-- members-only carve-out for `fantasy_league` chat, written as
-- `subject_type <> 'fantasy_league' OR (member check)`. Migration 226 then
-- widened the subject-type constraint to include `fantasy_feed` WITHOUT
-- revisiting the policy, so Social post comments silently landed in the
-- "everything that isn't league chat is public" branch.
--
-- Verified against production before this migration: an anon-key
-- `GET /rest/v1/comments` returned 39 `fantasy_feed` rows, 11 `debate`, 1
-- `pack`, and correctly 0 `fantasy_league`.
--
-- The rule applied here matches the posts themselves: migration 226 gates
-- `fantasy_feed_events` with `for select to authenticated using (true)`, so the
-- replies on those posts get the same bar. Deliberately NOT encoding the
-- Fantasy launch allowlist here: that list lives in src/lib/fantasy/flag.ts and
-- is documented there as "a VISIBILITY gate, not a security boundary", and it
-- is due to be lifted; a DB policy mirroring it would rot on the day Fantasy
-- opens up. Authenticated-only is the durable boundary, and it is exactly what
-- the parent posts already require.
--
-- SAFE TO APPLY BEFORE THE APP DEPLOY. No application read path depends on this
-- policy: GET /api/comments reads every row through the SERVICE client
-- (src/app/api/comments/route.ts, `svc`), so guests keep seeing comments on
-- public surfaces exactly as they do today. This policy governs only direct
-- PostgREST access, which is the hole being closed.
--
-- The insert policy is left alone on purpose: it already requires
-- `auth.uid() = user_id`, which no anonymous caller can satisfy.
-- `debate` and `pack` threads keep their existing public read: those are public
-- discussion surfaces by design and are unaffected here.

begin;

drop policy if exists "comments read" on comments;
create policy "comments read" on comments
  for select using (
    deleted_at is null
    and (
      case subject_type
        -- League chat: members only (unchanged from migration 209).
        when 'fantasy_league' then exists (
          select 1 from fantasy_league_members m
          where m.league_id = comments.subject_id and m.user_id = auth.uid()
        )
        -- Social posts: signed in only, matching fantasy_feed_events itself.
        when 'fantasy_feed' then auth.uid() is not null
        -- pack + debate: public discussion, unchanged.
        else true
      end
    )
  );

commit;

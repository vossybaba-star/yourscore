-- 258_member_challenges_lifecycle.sql
-- Phase 3A: the challenge LIFECYCLE on top of 255's foundation. One-tap
-- accept (the opponent's "Play" tap IS acceptance — see acceptChallenge in
-- challenges.ts), an explicit cancel for the challenger, and the bookkeeping
-- a completed/expired challenge now needs to post a result card and notify
-- both sides exactly once.
--
--   awaiting_opponent — reserved for a future game whose adapter needs to
--     create a member_challenges row before the opponent has anything to
--     accept yet (quiz_battle always goes straight to 'pending' today — see
--     challengeGames.ts). Added now so the CHECK constraint doesn't need a
--     second migration when that adapter lands.
--   void — a challenge invalidated outside the normal decline/expire/cancel
--     paths (e.g. a moderation action on one of the two participants).
--
-- message / created_from(_entity_id) / rematch_of_challenge_id / series_id /
-- scoring_version are all Phase 3A surface for createChallenge's optional
-- message, "where did this challenge start" attribution, and a future
-- rematch/series feature — unused columns are cheap, a second migration to
-- add them later isn't.
--
-- Security posture unchanged from 255: RLS still restricts SELECT to the two
-- participants, still NO insert/update/delete policy — every write here goes
-- through the service-role client (src/lib/fantasy/challenges.ts and the
-- /api/fantasy/challenges/* routes), same as before.

alter table member_challenges drop constraint if exists member_challenges_status_check;
alter table member_challenges add constraint member_challenges_status_check
  check (status in (
    'draft', 'pending', 'accepted', 'declined', 'expired', 'active',
    'completed', 'cancelled', 'awaiting_opponent', 'void'
  ));

alter table member_challenges add column if not exists message text;
alter table member_challenges add column if not exists created_from text;
alter table member_challenges add column if not exists created_from_entity_id text;
alter table member_challenges add column if not exists rematch_of_challenge_id uuid
  references member_challenges(id) on delete set null;
alter table member_challenges add column if not exists series_id uuid;
alter table member_challenges add column if not exists sent_at timestamptz not null default now();
alter table member_challenges add column if not exists declined_at timestamptz;
alter table member_challenges add column if not exists cancelled_at timestamptz;
alter table member_challenges add column if not exists scoring_version text;

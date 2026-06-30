-- 56_group_challenges.sql
-- Phase 2 async multiplayer: N-player "group" challenges. A generic engine
-- (group_challenges + group_challenge_participants) alongside the 1v1
-- h2h_challenges; the Your-Turns inbox unions both. Everyone plays the same quiz
-- async and is ranked on a leaderboard.
--
-- NB tables are prefixed group_* — a defunct, empty legacy `challenges` table
-- (slug/title/team_name…) already exists and is left untouched.
--
-- Security posture matches h2h_challenges: rows are public-readable (link join +
-- leaderboard) and ALL writes go through service-role API routes (create / join /
-- play / seen) so scoring stays authoritative. No client write policies.

create table if not exists group_challenges (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'group',          -- group | daily (later)
  creator_id      uuid not null references auth.users(id) on delete cascade,
  creator_name    text not null,
  quiz_pack_id    text not null,
  quiz_pack_name  text not null,
  total_questions int  not null,
  max_score       int  not null,
  status          text not null default 'open',           -- open | complete | expired
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days')
);

create table if not exists group_challenge_participants (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references group_challenges(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null,
  score         int,                                      -- null until played
  correct       int,
  invited       boolean not null default false,           -- directly invited (vs link / creator)
  played_at     timestamptz,
  seen          boolean not null default false,           -- inbox unread, for invited
  created_at    timestamptz not null default now(),
  unique (challenge_id, user_id)
);

alter table group_challenges enable row level security;
drop policy if exists "group_challenges_read" on group_challenges;
create policy "group_challenges_read" on group_challenges for select to public using (true);

alter table group_challenge_participants enable row level security;
drop policy if exists "group_challenge_participants_read" on group_challenge_participants;
create policy "group_challenge_participants_read" on group_challenge_participants for select to public using (true);

create index if not exists group_challenges_creator_idx         on group_challenges (creator_id, created_at desc);
create index if not exists group_chal_participants_chal_idx      on group_challenge_participants (challenge_id);
create index if not exists group_chal_participants_user_idx      on group_challenge_participants (user_id, score);

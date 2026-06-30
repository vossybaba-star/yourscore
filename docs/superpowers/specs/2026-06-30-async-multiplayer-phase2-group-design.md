# Async Multiplayer — Phase 2 Design: Group Challenges

**Date:** 2026-06-30
**Scope:** N-player async "group" challenges (you + N friends on one quiz, ranked on a leaderboard). The shared N-player engine; daily-vs-friends is a thin layer on top, built next.

Builds on Phase 1 (async 1v1 on `h2h_challenges`, the Your-Turns inbox). Phase 1's 1v1 schema has fixed `challenger_*/opponent_*` columns and can't extend to N — so Phase 2 introduces a **generic participants model** and the inbox **unions** 1v1 + group.

## Decisions (locked with founder)
- **Leaderboard model:** everyone plays the same quiz async; participants are ranked 1st/2nd/3rd… as scores land. No single "score to beat."
- **Membership:** **both** — invite specific friends (multi-select → their inbox) **and** a shareable link anyone can join.
- **Creator flow:** creator's **choice** — play first to seed the board, or just set it up and play later.
- **Order:** group challenges first; daily-vs-friends next (an auto-enrolled group with a fresh daily quiz).

> **Build note (2026-06-30):** tables shipped as `group_challenges` /
> `group_challenge_participants` — a defunct empty legacy `challenges` table
> already existed. Create ships as **play-first only** (the post-result
> "Challenge a group" button); the set-up-without-playing path is deferred.

## Data model
```sql
create table challenges (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'group',           -- group | daily (later)
  creator_id uuid not null references auth.users(id) on delete cascade,
  creator_name text not null,
  quiz_pack_id text not null,
  quiz_pack_name text not null,
  total_questions int not null,
  max_score int not null,
  status text not null default 'open',          -- open | complete | expired
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create table challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  score int,                                     -- null until played
  correct int,
  invited boolean not null default false,        -- directly invited (vs link/creator)
  played_at timestamptz,
  seen boolean not null default false,           -- inbox unread, for invited
  created_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);
```
- The `id` is the link token (public-readable, like `/h2h/[id]`) — no separate invite code.
- **RLS:** `challenges` + `challenge_participants` public `select` (link join + leaderboard). All writes server-only (service role) so scoring stays authoritative — same posture as `h2h_challenges`.

## Routes
- `POST /api/challenge/create` — creator + quiz + optional own score + `invitedUserIds[]`. Inserts the `challenges` row, a creator participant (score if they played, else null), and an `invited` participant per friend. Returns `{ id }`.
- `POST /api/challenge/join` — `{ challengeId }` — add the caller as a (link-joined) participant if not already in. Returns `{ id }`.
- `POST /api/challenge/play` — `{ challengeId, answers }` — server-grade (reuse the `h2h/play` grading: quiz-pack answers + v2 scoring), upsert the caller's participant `score/correct/played_at`. Auto-joins the caller if they arrived via link.
- `POST /api/challenge/seen` — invited participant clears their inbox unread.

## Screens
- **Group board** `/g/[id]` — public. Header (quiz + creator + N players + "X days left"), the ranked leaderboard (played participants by score, medals top 3, "you" highlighted), pending players ("yet to play"), and a CTA: **Play** (if I haven't) / **Share** (native sheet) / **Join & play** (link visitor not yet in).
- **Create** — from the post-result screen (the existing "Challenge a friend" gains a "Challenge a group" path) and from `/play`: pick quiz → multi-select friends → choose "play now" or "skip" → create. Reuses the quiz play UI with `?group=<id>` to record each play via `/api/challenge/play`.
- **Inbox union** — `useYourTurns` also reads `challenge_participants`: *your turn* = invited + unplayed; *waiting* = I created + others pending; *results* = complete. Group rows show "Group · [quiz] · Nth of M". `usePendingTurns` adds unplayed-invited group count to the badge.

## Lifecycle & edges
- **Done:** `expires_at` (7 days) → cron flips `open`→`expired` (extend the existing `expire-challenges` cron to cover `challenges`). Board stays viewable. Unplayed invitees simply don't rank.
- **Creator skipped playing:** board can sit empty until someone plays — fine; "be the first" empty state.
- **Link join after expiry:** read-only board + "this challenge has ended."
- **Duplicate join / replay:** `unique(challenge_id,user_id)`; `/play` upserts (first score stands, or best — first stands, matching 1v1).
- **Account deletion:** cascade removes participant rows.

## Out of scope (Phase 2b / 3)
- **Daily-vs-friends** (next layer: `kind='daily'`, auto-enrol friends, fresh daily quiz, persistent board).
- Native (push on group invite/overtake, haptics, universal links) — rides the one rebuild.
- Group chat, re-rank notifications ("you got overtaken"), team modes.

## Verification
- `next build` green; migration applied + verified on prod; group board renders all states via a mock-harness; the create→play→rank loop driven where feasible (auth-gated, multi-player — same constraint as 1v1).

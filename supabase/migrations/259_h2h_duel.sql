-- 259_h2h_duel.sql
-- Phase 3B: Quiz Duel — "pick a pack neither of you has played, you both play
-- it fresh, best score wins". Unlike Quiz Battle (mode 'scorecard'), a duel's
-- h2h_challenges row is created BEFORE either side has a score — the
-- challenger's own challenger_score/correct/answers are unknown at insert
-- time, not just the opponent's the way scorecard rows have always worked.
--
-- h2h_challenges predates the migrations folder, so no CREATE/ALTER here ever
-- declared its constraints — but src/types/database.ts's generated Row type
-- confirms the live schema directly: challenger_score, challenger_correct and
-- challenger_name are typed as required (NOT NULL); challenger_answers is
-- already `Json | null` (nullable) and opponent_* are already nullable too
-- (scorecard rows have always had a null opponent side pre-play). So only the
-- three challenger_* columns below are the real fix; challenger_answers is
-- included anyway since `drop not null` is idempotent (a no-op on an
-- already-nullable column, never an error) and it keeps all four listed
-- together for anyone reading this later. createDuelChallenge (challenges.ts)
-- still POPULATES challenger_name at creation regardless (the sender is known
-- up front, only their score isn't) — the column is widened defensively, not
-- because this feature leaves it empty.
--
-- h2h_duel_attempts holds the two sides' in-progress duel plays. It exists
-- ONLY because h2h_challenges RLS is public read (qual=true, for share links
-- and the scorecard result page) — a duel attempt's answers/score must never
-- be readable by the OTHER player (or the world) before both have finished,
-- so they land here first, gated to their own row, and are copied onto the
-- public h2h_challenges row (challenger_*/opponent_* + status) by
-- /api/h2h/play ONLY once both attempts exist. No insert/update/delete
-- policy — every write is the service role (/api/h2h/play), same posture as
-- member_challenges and h2h_challenges itself.

alter table h2h_challenges alter column challenger_score drop not null;
alter table h2h_challenges alter column challenger_correct drop not null;
alter table h2h_challenges alter column challenger_name drop not null;
alter table h2h_challenges alter column challenger_answers drop not null;

create table if not exists h2h_duel_attempts (
  id           uuid primary key default gen_random_uuid(),
  h2h_id       uuid not null references h2h_challenges(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  answers      jsonb not null,
  score        int not null,
  correct_count int not null,
  completed_at timestamptz not null default now(),
  unique (h2h_id, user_id)
);

create index if not exists h2h_duel_attempts_h2h_idx on h2h_duel_attempts (h2h_id);

alter table h2h_duel_attempts enable row level security;

-- A player may read only THEIR OWN attempt — never their opponent's, and
-- never a public/anon read (contrast h2h_challenges' qual=true policy this
-- table exists to avoid). Reconcile (challenges.ts) and /api/h2h/play read
-- both sides via the service-role client, which bypasses RLS entirely.
drop policy if exists h2h_duel_attempts_own_read on h2h_duel_attempts;
create policy h2h_duel_attempts_own_read on h2h_duel_attempts
  for select using (auth.uid() = user_id);

-- No insert/update/delete policy — service role only (see file doc above).

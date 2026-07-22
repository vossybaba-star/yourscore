-- "Perfect 10" — a standalone ranked top-10 list game (third Quiz game-type).
-- Name everyone in a ranked top-10 football list (e.g. "Premier League's
-- all-time top 10 goalscorers"). One list assigned per day for everyone, plus
-- link-based async challenges.
--
-- p10_players carries the full guessable name pool (id/name/normalized only —
-- no ranks, no answers). p10_lists carries the actual answers (entries jsonb)
-- — MUST NEVER be readable by anon/authenticated. p10_attempts is per-user
-- progress.
--
-- House pattern: ENABLE ROW LEVEL SECURITY + revoke all from anon/authenticated
-- (deny-all; no policies). Service role bypasses RLS and is the only writer/reader.

begin;

-- ── p10_players ──────────────────────────────────────────────────────────────
-- Full guessable pool. id = SportMonks player id where available, else a
-- negative synthetic id for pre-SportMonks-coverage legends force-inserted by
-- generate-lists.mjs. normalized = lowercase, diacritic-stripped, whitespace-
-- collapsed name, used for guess matching.
create table if not exists public.p10_players (
  id bigint primary key,
  name text not null,
  normalized text not null,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists p10_players_normalized_idx on public.p10_players (normalized);

-- ── p10_lists ────────────────────────────────────────────────────────────────
-- day is the daily assignment (NULL for lists not yet scheduled / challenge-only
-- pools). entries is an array of
--   { rank, display, surname, aliases: string[], clue1, clue2 }
-- — this column contains the answers and must never be exposed to a client.
create table if not exists public.p10_lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  day date unique,
  status text not null default 'draft',
  entries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists p10_lists_status_idx on public.p10_lists (status);

-- ── p10_attempts ─────────────────────────────────────────────────────────────
-- One row per (list, user) for signed-in players. Guests are stateless (client
-- localStorage) and never get a row here; user_id is nullable for forward-
-- compatibility only — the app never actually inserts a guest row.
create table if not exists public.p10_attempts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.p10_lists(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  found jsonb not null default '[]'::jsonb,
  hints jsonb not null default '[]'::jsonb,
  strikes int not null default 0,
  tokens_left int not null default 3,
  score int not null default 0,
  done boolean not null default false,
  share_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (list_id, user_id)
);
create index if not exists p10_attempts_share_token_idx on public.p10_attempts (share_token);
create index if not exists p10_attempts_user_idx on public.p10_attempts (user_id);

-- ── RLS: deny-all. Service role bypasses RLS and is the only reader/writer. ──
alter table public.p10_players enable row level security;
alter table public.p10_lists enable row level security;
alter table public.p10_attempts enable row level security;

revoke all on public.p10_players from anon, authenticated;
revoke all on public.p10_lists from anon, authenticated;
revoke all on public.p10_attempts from anon, authenticated;

commit;

-- Halftime Quiz Packs (Scope B) — the data layer.
--
-- A quiz pack for every Premier League fixture, released at the REAL halftime
-- whistle (SportMonks state_id == 3), playable solo or in a Lobby.
--
-- Three tables, all service-role only:
--   halftime_releases  one row per fixture — the per-fixture state machine plus
--                      the frozen question content (base slate + fresh slice).
--   halftime_control   the matchday kill switch for the fresh slice.
--   halftime_heartbeat the VPS poller's liveness beat, read by the watchdog.
--
-- ADDITIVE ONLY. No existing table is altered. quiz_packs is reused as-is:
-- the pack row is inserted at release with a pre-assigned uuid and carries its
-- fixture linkage in `metadata.halftime` (no new columns, no new status value).
--
-- Content-safety invariant this schema exists to enforce: every question is
-- frozen into halftime_releases BEFORE kick-off, and release only copies that
-- frozen jsonb into quiz_packs. Nothing generates or mutates content after the
-- kickoff whistle, so a question can never reference a first-half event.

begin;

-- 1. Per-fixture state machine + frozen content ------------------------------

create table if not exists halftime_releases (
  id            uuid primary key default gen_random_uuid(),
  fixture_id    bigint not null unique,        -- SportMonks fixture id
  season_id     bigint,                        -- 28083 for 2026/27
  round_name    text,                          -- SportMonks round (GW) label
  -- Pre-assigned at assembly; the quiz_packs row itself is only inserted AT
  -- RELEASE, so the pack is invisible and ungradeable before the whistle.
  pack_id       uuid,
  home          text not null,
  away          text not null,
  kickoff_at    timestamptz not null,

  state         text not null default 'scheduled'
    check (state in ('scheduled','base_ready','staged','released','released_late','cancelled','failed')),

  -- Approved 10-question fallback set, written the day before from historic /
  -- static facts. A pack can always ship from these alone.
  base_questions  jsonb,
  -- [{question, options{A..D}, answer, difficulty, claims[], fact,
  --   status: 'pending'|'approved'|'vetoed'|'dropped'}]
  fresh_questions jsonb,

  -- THE FROZEN PACK. Written once at assembly (T-10, pre-kickoff) and copied
  -- verbatim into quiz_packs at the whistle. This column is what makes the hard
  -- rule structural rather than a matter of prompt discipline: release performs
  -- a jsonb copy, never a generation. It also gives the acceptance test its
  -- proof (AC3b) — the released pack is byte-comparable to this snapshot.
  -- The single exception is a founder veto landing after the deadline but
  -- before the whistle: the vetoed question is PULLED and backfilled from the
  -- (day-before, already-approved) base slate. Removal + substitution from
  -- pre-kickoff content only; no new content is ever authored after kick-off.
  pack_questions  jsonb,

  fresh_state   text not null default 'none'
    check (fresh_state in ('none','pending_veto','approved','vetoed','killed','skipped')),

  veto_deadline_at    timestamptz,
  telegram_message_id bigint,
  released_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Invariants the release path depends on. A fixture cannot be staged without
  -- a pre-assigned pack id AND its frozen questions, and cannot be released
  -- without a release timestamp — so a buggy caller gets a constraint violation
  -- rather than a silently pack-less "released" fixture players can never open,
  -- or a staged fixture with nothing to serve at the whistle.
  constraint halftime_staged_needs_pack check (
    state not in ('staged','released','released_late')
    or (pack_id is not null and pack_questions is not null)
  ),
  constraint halftime_released_needs_timestamp check (
    state not in ('released','released_late') or released_at is not null
  )
);

-- Watchdog hot path: "today's rows still awaiting release".
create index if not exists halftime_releases_kickoff_idx
  on halftime_releases (kickoff_at);
create index if not exists halftime_releases_state_kickoff_idx
  on halftime_releases (state, kickoff_at);
-- One pack per fixture, enforced (guards a double-assembly assigning two packs).
create unique index if not exists halftime_releases_pack_id_uidx
  on halftime_releases (pack_id) where pack_id is not null;

-- 2. Matchday kill switch for the fresh slice --------------------------------

create table if not exists halftime_control (
  matchday    date primary key,               -- Europe/London date
  fresh_kill  boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- 3. Poller liveness ---------------------------------------------------------

create table if not exists halftime_heartbeat (
  id      text primary key,                   -- 'poller'
  beat_at timestamptz not null,
  detail  jsonb
);

-- 4. updated_at maintenance --------------------------------------------------
-- Own function (not a shared one) so this migration is self-contained.
-- SECURITY INVOKER + empty search_path: no privilege escalation surface.

create or replace function halftime_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Default EXECUTE on a new function is granted to PUBLIC — revoke it. (PUBLIC
-- is where the implicit grant lives; revoking only anon/authenticated would
-- leave it reachable.) Triggers still fire: they run as the table owner and do
-- not consult EXECUTE privileges.
revoke all on function halftime_touch_updated_at() from public;

drop trigger if exists halftime_releases_touch on halftime_releases;
create trigger halftime_releases_touch
  before update on halftime_releases
  for each row execute function halftime_touch_updated_at();

drop trigger if exists halftime_control_touch on halftime_control;
create trigger halftime_control_touch
  before update on halftime_control
  for each row execute function halftime_touch_updated_at();

-- 5. RLS ---------------------------------------------------------------------
-- Enable RLS and create NO policies: that is deny-all for anon + authenticated
-- (the notification_log precedent, migration 56). service_role has BYPASSRLS,
-- so the API routes — the only readers/writers — are unaffected.
--
-- Public reads reach this data ONLY through GET /api/halftime/today, which
-- serves a filtered projection (no questions, no fresh/veto state). Question
-- content must never be anon-readable before the whistle.

alter table halftime_releases  enable row level security;
alter table halftime_control   enable row level security;
alter table halftime_heartbeat enable row level security;

-- Defense in depth: also strip the table-level grants Supabase's default
-- privileges hand to anon/authenticated. RLS is the enforcement; this means a
-- permissive policy added by mistake later still cannot expose the questions.
-- service_role keeps its grants (BYPASSRLS does NOT bypass table privileges).
revoke all on halftime_releases  from anon, authenticated;
revoke all on halftime_control   from anon, authenticated;
revoke all on halftime_heartbeat from anon, authenticated;

commit;

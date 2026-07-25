-- Gameday Quiz — the pivot's data layer.
--
-- The Halftime Quiz becomes the Gameday Quiz: a pack per PL fixture, published
-- the day before the fixture by a Vercel cron, instead of at the real halftime
-- whistle (docs/gameday-quiz-spec.md). This is an ALTER of a LIVE table, not a
-- clean create: halftime_releases is already applied to prod (migration 93)
-- and is read by two live surfaces (src/app/api/clubs/table/route.ts, the
-- club-fan leaderboard, and src/app/api/pl/fixtures/route.ts, the PL tab).
--
-- Migration number picked at build time, numerically, against both the
-- migrations directory and prod (CLAUDE.md §4 — many applied migrations are
-- absent from schema_migrations, so the directory alone is not enough; this
-- was re-verified against prod before picking 110). Main tops out at 102
-- (with a duplicate 81); fantasy/season reaches 109; fantasy/advice reaches
-- 101. 110 is unclaimed by any of them.
--
-- The physical table KEEPS the name halftime_releases (locked — renaming it
-- would mean touching both live readers above for zero user benefit; same
-- precedent as rooms* tables staying "Lobbies" in product).
--
-- The quiz state machine is now, single direction:
--   scheduled -> base_ready -> approved -> published
-- with any pre-publish state -> cancelled | failed. 'staged' / 'released' /
-- 'released_late' STAY in the CHECK constraint — they now describe the
-- Halftime Prediction poll's own settlement bookkeeping only (§0.5), not the
-- quiz. The two concerns share one table; they must not share one state
-- field's meaning, so the app-level split lives in src/lib/gameday/shared.ts
-- (new machine) vs the surviving bits of src/lib/halftime/shared.ts.
--
-- ADDITIVE ONLY. No column or table this migration touches loses data.
-- Dropping the retired fresh-slice columns (fresh_questions, fresh_state,
-- veto_deadline_at, telegram_message_id) and the halftime_control table is a
-- later, separate migration, coordinated with removing every remaining
-- reader — NOT done here.
--
-- gameday_fantasy_awards (the fantasy bridge, §5) is DEFERRED — the founder's
-- call 2026-07-23: "wait for the fantasy stuff to be finished". Not created.

begin;

-- 1. halftime_releases — publish machinery + the new state values ------------

alter table halftime_releases
  add column if not exists gameweek               int,
  add column if not exists publish_at              timestamptz,
  add column if not exists questions               jsonb,
  add column if not exists published_at            timestamptz,
  add column if not exists kind                    text not null default 'fixture',
  add column if not exists second_half_started_at  timestamptz;

-- kind discriminates a per-fixture Gameday pack from a future per-gameweek
-- Recap pack (§6, not built in this workstream). Every existing/new fixture
-- row defaults to 'fixture'; playable-now reads (pl/fixtures, gameday/today,
-- the club-fan leaderboard) filter on it so a future recap row can never be
-- mistaken for a fixture pack.
alter table halftime_releases
  add constraint halftime_releases_kind_check check (kind in ('fixture', 'recap'));

-- The state CHECK gains 'approved' and 'published'. 'staged' / 'released' /
-- 'released_late' stay for the surviving prediction-poll bookkeeping (§0.5) —
-- dropped and re-added rather than left to drift, so the full legal set is
-- visible in one place.
alter table halftime_releases drop constraint if exists halftime_releases_state_check;
alter table halftime_releases add constraint halftime_releases_state_check check (
  state in (
    'scheduled', 'base_ready', 'approved', 'published',
    'staged', 'released', 'released_late',
    'cancelled', 'failed'
  )
);

-- halftime_staged_needs_pack and halftime_released_needs_timestamp
-- (93_halftime.sql:72-77) are UNCHANGED by this migration — verified they
-- reference only 'staged'/'released'/'released_late', all of which still
-- exist in the CHECK above, so they still hold.

-- New invariant for the new terminal quiz state: a published row must have a
-- pack to point at and its own frozen question snapshot.
alter table halftime_releases add constraint halftime_published_needs_pack check (
  state <> 'published' or (pack_id is not null and questions is not null)
);

-- Watchdog / publish-cron hot paths.
create index if not exists halftime_releases_publish_idx
  on halftime_releases (publish_at) where state = 'approved';
create index if not exists halftime_releases_gw_idx
  on halftime_releases (season_id, gameweek);

-- 2. halftime_predictions — two phases, one row each, per fixture -----------
--
-- §0.6 (same day, later): two prediction moments, neither attached to a quiz
-- pack. Both key on the fixture. 'prematch' predicts the full-time result and
-- closes at kickoff; 'halftime' predicts the second-half result and opens
-- once second_half_started_at is set. Existing rows (all pre-pivot, all
-- second-half calls) default to 'halftime' so they keep their meaning.
--
-- Uniqueness moves from one pick per user per fixture to one pick per user
-- per fixture PER PHASE. RLS posture (93/95_halftime_predictions.sql: enable
-- RLS, zero anon/authenticated policies, service_role only) is UNCHANGED —
-- not weakened, not touched.

-- pack_id was NOT NULL (95_halftime_predictions.sql) because the original
-- design resolved the fixture FROM a quiz pack's metadata. §0.6 explicitly
-- decouples both prediction phases from any pack — "neither is attached to a
-- quiz pack... does not require a pack to exist" — so the column can no
-- longer be populated at insert and must accept null. Column itself is kept
-- (not dropped) for the historical rows already carrying it.
alter table halftime_predictions alter column pack_id drop not null;

alter table halftime_predictions
  add column if not exists phase text not null default 'halftime';
alter table halftime_predictions drop constraint if exists halftime_predictions_phase_check;
alter table halftime_predictions add constraint halftime_predictions_phase_check
  check (phase in ('prematch', 'halftime'));

alter table halftime_predictions drop constraint if exists halftime_predictions_pkey;
alter table halftime_predictions add primary key (user_id, fixture_id, phase);

-- 2b. halftime_prediction_results — likewise phase-scoped --------------------
--
-- NOT in the spec's §2.1 SQL block, but required for the §0.6 mechanics to be
-- gradeable at all: 'prematch' settles against the FULL-TIME score and
-- 'halftime' settles against the SECOND-HALF-ONLY score (a different number).
-- One fixture can now legitimately have two result rows. Flagged in the build
-- report as an addition beyond the literal migration text in the brief.

alter table halftime_prediction_results
  add column if not exists phase text not null default 'halftime';
alter table halftime_prediction_results drop constraint if exists halftime_prediction_results_phase_check;
alter table halftime_prediction_results add constraint halftime_prediction_results_phase_check
  check (phase in ('prematch', 'halftime'));

alter table halftime_prediction_results drop constraint if exists halftime_prediction_results_pkey;
alter table halftime_prediction_results add primary key (fixture_id, phase);

commit;

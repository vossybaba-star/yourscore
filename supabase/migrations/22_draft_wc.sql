-- 22_draft_wc.sql
-- 38-0 World Cup Run — a solo campaign mirroring the real WC 2026 fixtures.
-- Plan: ~/.claude/plans/no-text-only-brainstorming-logical-shell.md
--
-- ADDITIVE. New tables only (draft_wc_runs, draft_wc_matches). Does NOT touch the
-- H2H draft_matches / draft_standings rails — a World Cup Run is its own progression.
-- Server stays authoritative: nation-locked XI validation, opponent generation, goal
-- resolution and stage transitions all run server-side via lib/draft/wc*.

begin;

-- A run: pick a nation, draft a nation-locked XI, progress through the real WC path.
-- status: active | eliminated | champion
-- stage:  group | r32 | r16 | qf | sf | final
create table if not exists draft_wc_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  nation        text not null,
  seed          text not null,                       -- drives the deterministic bracket plan
  status        text not null default 'active',
  stage         text not null default 'group',
  stage_index   int  not null default 0,             -- 0=group,1=r32,2=r16,3=qf,4=sf,5=final

  formation     text not null,
  squad         jsonb not null,                      -- current XI (PlacedPlayer[])
  strength      numeric not null default 0,
  plan          jsonb not null,                      -- WCPlan: group + knockout opponents

  group_played  int not null default 0,              -- 0..3 group games done
  group_points  int not null default 0,              -- W=3, D=1
  upgrades_left int not null default 0,               -- swap picks available before the next match

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
alter table draft_wc_runs enable row level security;
drop policy if exists "draft_wc_runs owner" on draft_wc_runs;
create policy "draft_wc_runs owner" on draft_wc_runs
  for select using (auth.uid() = user_id);
create index if not exists draft_wc_runs_user_idx on draft_wc_runs (user_id, created_at desc);

-- One played match within a run (3 group games + up to 5 knockouts).
create table if not exists draft_wc_matches (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references draft_wc_runs(id) on delete cascade,
  stage            text not null,
  idx              int  not null default 0,           -- group game number (0..2); 0 for knockouts
  opponent_nation  text not null,
  opponent_crest   text,
  opponent_strength numeric not null,
  you_goals        int not null,
  opp_goals        int not null,
  pens_you         int,
  pens_opp         int,
  won              boolean,                            -- null = draw (group only)
  detail           jsonb,                              -- full MatchReport for the reveal/share
  played_at        timestamptz not null default now()
);
alter table draft_wc_matches enable row level security;
drop policy if exists "draft_wc_matches owner" on draft_wc_matches;
create policy "draft_wc_matches owner" on draft_wc_matches
  for select using (
    exists (select 1 from draft_wc_runs r where r.id = run_id and r.user_id = auth.uid())
  );
create index if not exists draft_wc_matches_run_idx on draft_wc_matches (run_id, played_at);

commit;

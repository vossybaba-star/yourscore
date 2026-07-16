-- Quiz pack scheduling: decouple APPROVAL from RELEASE.
--
-- Until now publish == approve == live: scripts/launch-daily.mjs published a pack,
-- blocked on a Telegram gate, and the pack was instantly visible. That works for one
-- pack a day. It does not work for "author a week's batch on Monday, have the founder
-- approve it once, then drip the packs out every other day".
--
-- So a pack now has three states, and the two axes are independent:
--
--   Draft (invisible)     status='draft'      rotation_active=false  approved_at IS NULL
--   Approved + scheduled  status='draft'      rotation_active=false  approved_at set, release_at set
--   Live                  status='published'  rotation_active=true   approved_at set
--
-- No new status value is needed: the existing CHECK already permits 'draft' — nothing
-- has ever written it. We are activating a dormant state, not changing the enum.
--
-- rotation_active is already the visibility gate (src/app/api/quiz/packs/route.ts filters
-- on status='published' AND rotation_active), so drafts are invisible to players for free.

alter table quiz_packs
  add column if not exists release_at  timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists theme       text;

comment on column quiz_packs.release_at  is 'When the release job should flip this pack live. Null = unscheduled.';
comment on column quiz_packs.approved_at is 'Set by the founder in /admin/quiz. A pack is NEVER released without this.';
comment on column quiz_packs.theme       is 'Human theme label, e.g. "Transfer Deadline Day". Distinct from parameter (the quiz entity).';

-- The release job's only query. Partial so it stays tiny — it indexes the handful of
-- approved-but-unreleased packs, not the 284 already-published ones.
create index if not exists quiz_packs_pending_release_idx
  on quiz_packs (release_at)
  where status = 'draft' and approved_at is not null;

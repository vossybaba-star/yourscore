-- WC Thanks — one-time feedback + App Store review prompt for the World Cup
-- Mastermind cohort (198 users who played more than 10 ranked daily runs).
--
-- Two tables:
--   wc_thanks_prompts  — who's in the cohort + where each user is in the
--                         two-step flow (feedback, then review ask). The
--                         SEED below is the cohort definition: pre-computed
--                         once from draft_wc_runs, not recomputed live, so
--                         the ask never re-arms for someone who plays more
--                         WC runs after this ships.
--   product_feedback   — free-text feedback captured anywhere this prompt
--                         (or a future one) fires. `source` distinguishes
--                         campaigns; admin reads via service role only.

begin;

create table if not exists wc_thanks_prompts (
  user_id           uuid primary key references profiles(id) on delete cascade,
  feedback_done_at  timestamptz,
  review_done_at    timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists product_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  source     text not null default 'wc-thanks',
  created_at timestamptz not null default now()
);

create index if not exists product_feedback_user_idx on product_feedback (user_id);

-- Seed the cohort: everyone with more than 10 ranked WC Mastermind days.
insert into wc_thanks_prompts (user_id)
select user_id from draft_wc_runs
where ranked
group by user_id
having count(distinct run_date) > 10
on conflict do nothing;

-- RLS ---------------------------------------------------------------------
-- wc_thanks_prompts: a user may read and advance their own row (the API
-- route stamps feedback_done_at / review_done_at). No insert policy — rows
-- only ever come from the seed above (or a future backend job); no delete
-- policy — the cohort membership isn't the user's to remove.

alter table wc_thanks_prompts enable row level security;

create policy "Users select own wc_thanks_prompts" on wc_thanks_prompts
  for select using (auth.uid() = user_id);

create policy "Users update own wc_thanks_prompts" on wc_thanks_prompts
  for update using (auth.uid() = user_id);

-- product_feedback: a user may submit their own feedback. No select policy —
-- this is a write-only mailbox from the client's point of view; admin reads
-- happen via service role, which bypasses RLS.

alter table product_feedback enable row level security;

create policy "Users insert own product_feedback" on product_feedback
  for insert with check (auth.uid() = user_id);

commit;

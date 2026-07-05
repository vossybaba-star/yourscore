-- Anonymous debate votes (founder, Jul 5): nobody should need an account to
-- have their say on the daily debate — the share-card funnel must be
-- tap → voted. Guests vote under a per-device key; accounts keep using
-- debate_votes. Counts are the union. Commenting still requires an account
-- (that's the sign-up gate now). Accepted trade-off: device keys are
-- spoofable — debates are banter, not the £100 board.

begin;

create table if not exists debate_anon_votes (
  debate_id  uuid not null references debates(id) on delete cascade,
  voter_key  text not null check (char_length(voter_key) between 8 and 64),
  option_idx smallint not null check (option_idx >= 0 and option_idx <= 3),
  created_at timestamptz not null default now(),
  primary key (debate_id, voter_key)
);
-- Service-role only: RLS on, no policies. All writes go through the API,
-- which rate-limits by IP.
alter table debate_anon_votes enable row level security;

commit;

-- Daily debates: one debate per calendar date, allocated explicitly.
-- Founder call (Jul 5): the modulo rotation was too clever — a bank edit
-- shifted the live debate mid-day and orphaned its votes. Now each debate
-- carries its date; serving is "the debate dated today (or the most recent
-- past one)". The schedule is authored and visible in scripts/seed-debates.mjs.

begin;

alter table debates add column if not exists day date;
create unique index if not exists debates_day_uidx on debates (day) where day is not null;

commit;

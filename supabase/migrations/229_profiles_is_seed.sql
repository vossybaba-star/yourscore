-- 229_profiles_is_seed.sql
-- Marks the cold-start seed accounts — realistic-looking managers created to give
-- the follow graph, the discover list, and the activity feed something to show
-- before real users arrive. The flag exists so seed accounts are always
-- distinguishable: excludable from prizes/analytics, and wipeable in one delete.
--
-- Guardrail (founder call): seed users are followable and make feed moves, but
-- get NO fabricated points or ranks — standings fill honestly from GW1.

alter table public.profiles
  add column if not exists is_seed boolean not null default false;

create index if not exists profiles_is_seed_idx on public.profiles (is_seed) where is_seed;

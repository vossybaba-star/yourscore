-- 47_username_unique.sql
-- Username is now the public identity (handle), so it must be unique. Case-insensitive,
-- partial (only enforced on non-empty handles — accounts without one yet are unconstrained).
-- ADDITIVE; safe to apply if no two existing accounts already share a handle (most are null).

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null and username <> '';

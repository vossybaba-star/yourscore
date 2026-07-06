-- 67: no two ACTIVE questions may share the same normalized text within an entity.
--
-- The health checker caught the same question dealt twice in one quiz: two rows
-- with different ids but identical text ("Who holds the record for most
-- appearances for Arsenal?") defeat id-based session dedup. App-level guards
-- can race or be bypassed by ad-hoc scripts — this index is the backstop.
--
-- Normalization matches src/lib/questions.ts / scripts/dedupe-questions.mjs:
-- lowercase, strip non-alphanumerics, collapse whitespace, trim.
--
-- Prereq: run `node scripts/dedupe-questions.mjs --commit` first, or creation
-- fails on the existing duplicates.

create unique index if not exists questions_active_entity_normtext_uidx
  on questions (
    entity,
    btrim(regexp_replace(regexp_replace(lower(question), '[^a-z0-9 ]', '', 'g'), ' +', ' ', 'g'))
  )
  where status = 'active';

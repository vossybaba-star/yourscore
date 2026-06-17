-- 45_draft_wc_prev_edition.sql
-- Catch-up: let a user play the IMMEDIATELY-PREVIOUS ranked edition once if they missed it.
-- Track the prior edition alongside the active one; roll-wc-edition.mjs maintains it (prev =
-- the edition being replaced). Backfill prev = active - 1 day so catch-up works right away.

begin;

alter table wc_ranked_edition add column if not exists prev_edition text;

update wc_ranked_edition
  set prev_edition = to_char((edition::date - interval '1 day'), 'YYYY-MM-DD')
  where prev_edition is null and edition ~ '^\d{4}-\d{2}-\d{2}$';

commit;

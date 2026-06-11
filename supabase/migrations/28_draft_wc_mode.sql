-- 28_draft_wc_mode.sql
-- 38-0 World Cup Run — add the run MODE.
--
-- ADDITIVE. Adds a single column to draft_wc_runs. Existing rows are nation-locked runs,
-- so the column defaults to 'nation'. The new 'world' mode is an open draft (any WC 2026
-- nation's players) playing a generated gauntlet; such runs store nation = 'World XI'.

begin;

alter table draft_wc_runs
  add column if not exists mode text not null default 'nation';

commit;

-- 62_h2h_battle.sql
-- Fresh Quiz Battle: per-question reveal + battle/scorecard mode.
-- ADDITIVE and safe on a live table — nullable/defaulted columns, no rewrite.
--
--  mode              'scorecard' (challenger had played it → "beat X" target stays
--                    visible) | 'battle' (fresh → total hidden until both finish)
--  challenger_answers per-question detail for the challenger  [{letter, correct}]
--  opponent_answers   per-question detail for the opponent     [{letter, correct, elapsedMs}]
-- Both answer columns power the question-by-question reveal once both sides are done.

alter table h2h_challenges add column if not exists mode text not null default 'scorecard';
alter table h2h_challenges add column if not exists challenger_answers jsonb;
alter table h2h_challenges add column if not exists opponent_answers jsonb;

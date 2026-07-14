-- 81_fantasy_chips.sql — chips + the wildcard (design §4b, D:123-156).
--
-- Chips are LOYALTY, not performance: a token every 4 gameweeks you actually PLAY
-- (a rolled-over week earns nothing — D:91-93). Hold up to 3, spend one per week.
--
-- The wildcard runs on its own track: ONE issued per half-season, use-it-or-lose-it
-- at the halfway deadline, plus at most ONE bonus per half minted by a perfect
-- knowledge round. It is also the anti-dead-team rescue tool, which is why it is
-- issued to everyone rather than earned — a broken squad must never be locked out.
begin;

alter table fantasy_squads
  add column if not exists chips              int not null default 0,  -- tokens held (cap 3)
  add column if not exists chip_progress      int not null default 0,  -- played gameweeks toward the next token
  add column if not exists wildcards          int not null default 0,  -- wildcards held right now
  add column if not exists wildcard_half      int,                     -- the half they're valid in; they expire with it
  add column if not exists bonus_wildcard_half int,                    -- the half a perfect round already minted one in
  -- The half we last handed out the STANDARD (issued-to-everyone) wildcard for.
  -- It has to be tracked apart from wildcard_half, because a bonus wildcard from a
  -- perfect round also sets wildcard_half — and without this column that bonus
  -- would make the issuer think it had already issued, so a player who quizzed
  -- perfectly in the first week of a half would silently NEVER get their issued
  -- wildcard. One column cannot answer both "when do these expire" and "have we
  -- issued this half's yet".
  add column if not exists issued_half        int;

-- Which chip (if any) was played this gameweek. One per gameweek, and it is part
-- of the locked snapshot, so re-scoring a week always re-applies the same chip.
alter table fantasy_entries
  add column if not exists chip text;

commit;

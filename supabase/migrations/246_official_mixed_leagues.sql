-- YourScore-run leagues carry a verified tick (founder, 3 Aug). `official` marks
-- any league YourScore created: the club fan leagues, the Founder League, and a
-- handful of MIXED cross-fan leagues that anyone can join — proof we back fans
-- mixing, not just sitting in their own club's corner.
alter table public.fantasy_leagues add column if not exists official boolean not null default false;
update public.fantasy_leagues set official = true where kind in ('club', 'founder');

-- The mixed leagues sit at the top of Discover. Public + joinable by anyone, no
-- club gate. Owned by the YourScore system account (babavossy), same as the club
-- and Founder leagues. Idempotent on the join code.
insert into public.fantasy_leagues (owner_id, name, join_code, is_public, kind, official)
values
  ('4050ec90-5323-46aa-8dc0-811e0aac701a', 'Rivals Reunited',      'MXDRVL2', true, 'public', true),
  ('4050ec90-5323-46aa-8dc0-811e0aac701a', 'The Neutrals'' Lounge', 'MXDNTR3', true, 'public', true),
  ('4050ec90-5323-46aa-8dc0-811e0aac701a', 'Banter FC',            'MXDBNT4', true, 'public', true),
  ('4050ec90-5323-46aa-8dc0-811e0aac701a', 'The Melting Pot',      'MXDMLT5', true, 'public', true),
  ('4050ec90-5323-46aa-8dc0-811e0aac701a', 'Anyone''s Game',       'MXDANY6', true, 'public', true)
on conflict (join_code) do nothing;

-- Owner membership so the tiles show a member and the owner can moderate.
insert into public.fantasy_league_members (league_id, user_id)
select id, owner_id from public.fantasy_leagues where join_code in
  ('MXDRVL2', 'MXDNTR3', 'MXDBNT4', 'MXDMLT5', 'MXDANY6')
on conflict (league_id, user_id) do nothing;

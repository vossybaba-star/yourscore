-- 35_club_leagues.sql
-- Club Leagues: partner-owned branded leagues + community spaces (pubs, creators,
-- sponsors). Spec: docs/superpowers/specs/2026-06-12-club-leagues-design.md
--
-- Model: a Club League has an always-on overall board (YourScore Rank scoped to its
-- members — read-time via get_yourscore_leaderboard(p_user_ids), no new scoring
-- writes), partner-run Quiz events (each with its own board), and a derived activity
-- feed. Event attempt points count ONLY on the event board — they never feed
-- profiles.total_score / quiz_attempts / YourScore points (partner-authored packs
-- must not mint global ranking points).
--
-- Write paths are server-only (service role via /api/club/*): no insert/update/delete
-- RLS policies for authenticated. Select policies exist so members can read their
-- league (and for future realtime), but the hub API returns everything server-side.

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists club_leagues (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  tier text not null default 'pub' check (tier in ('pub','creator','sponsor')),
  logo_url text,
  cover_url text,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  welcome_text text,
  prize_text text,
  announcement text,
  join_code text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists club_league_members (
  league_id uuid not null references club_leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists club_league_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references club_leagues(id) on delete cascade,
  title text not null,
  description text,
  -- Source pack (informational); questions are SNAPSHOTTED below at creation so a
  -- partner editing/deleting the pack can't break a live quiz night.
  pack_id uuid references quiz_packs(id) on delete set null,
  questions jsonb not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  prize_text text,
  -- live/ended are DERIVED from the window; status only holds intent.
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists club_event_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references club_league_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null default 0,
  max_score int not null default 0,
  correct_count int not null default 0,
  answers jsonb,
  completed_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists club_league_members_user_idx on club_league_members(user_id);
create index if not exists club_league_events_league_idx on club_league_events(league_id, starts_at desc);
create index if not exists club_event_attempts_event_idx on club_event_attempts(event_id, score desc, completed_at asc);
create index if not exists club_event_attempts_user_idx on club_event_attempts(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table club_leagues enable row level security;
alter table club_league_members enable row level security;
alter table club_league_events enable row level security;
alter table club_event_attempts enable row level security;

-- Members (incl. owner, who is always also a member row) read their league.
-- Public landing data is served by the API via service role — no anon policy.
drop policy if exists "club_leagues member read" on club_leagues;
create policy "club_leagues member read" on club_leagues
  for select using (
    exists (
      select 1 from club_league_members m
      where m.league_id = id and m.user_id = auth.uid()
    )
  );

-- Own rows only — a self-referencing membership policy would recurse
-- (same reason draft_league_members does this). The full member list /
-- boards are served by the hub API via service role.
drop policy if exists "club_league_members own read" on club_league_members;
create policy "club_league_members own read" on club_league_members
  for select using (auth.uid() = user_id);

drop policy if exists "club_league_events member read" on club_league_events;
create policy "club_league_events member read" on club_league_events
  for select using (
    exists (
      select 1 from club_league_members m
      where m.league_id = club_league_events.league_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "club_event_attempts member read" on club_event_attempts;
create policy "club_event_attempts member read" on club_event_attempts
  for select using (
    exists (
      select 1
      from club_league_events e
      join club_league_members m on m.league_id = e.league_id
      where e.id = club_event_attempts.event_id and m.user_id = auth.uid()
    )
  );

-- ── Activity feed (read-time, derived — no feed writes anywhere) ────────────
-- service_role only: the hub API checks membership, then calls this.

create or replace function get_club_league_feed(p_league_id uuid, p_limit int default 30)
returns table (
  kind text,
  user_id uuid,
  display_name text,
  avatar_url text,
  detail jsonb,
  created_at timestamptz
) language sql stable security definer set search_path = public as $$
  with members as (
    select m.user_id, m.joined_at,
           coalesce(nullif(p.display_name, ''), 'Player') as display_name,
           p.avatar_url
    from club_league_members m
    join profiles p on p.id = m.user_id
    where m.league_id = p_league_id
  ),
  feed as (
    -- New members
    select 'join'::text as kind, m.user_id, m.display_name, m.avatar_url,
           '{}'::jsonb as detail, m.joined_at as created_at
    from members m

    union all
    -- 38-0 Live H2H results involving a member (their POV)
    select 'h2h_result', m.user_id, m.display_name, m.avatar_url,
           jsonb_build_object(
             'outcome', case
               when lm.winner_id = m.user_id then 'won'
               when lm.winner_id is null then 'drew'
               else 'lost' end,
             'opponent', case when lm.p1_id = m.user_id then lm.p2_name else lm.p1_name end,
             'score_for', case when lm.p1_id = m.user_id
               then coalesce(lm.h1_p1,0) + coalesce(lm.h2_p1,0)
               else coalesce(lm.h1_p2,0) + coalesce(lm.h2_p2,0) end,
             'score_against', case when lm.p1_id = m.user_id
               then coalesce(lm.h1_p2,0) + coalesce(lm.h2_p2,0)
               else coalesce(lm.h1_p1,0) + coalesce(lm.h2_p1,0) end
           ),
           lm.resolved_at
    from draft_live_matches lm
    join members m on m.user_id in (lm.p1_id, lm.p2_id)
    where lm.resolved_at is not null

    union all
    -- Solo quiz completions by members
    select 'solo_quiz', m.user_id, m.display_name, m.avatar_url,
           jsonb_build_object('score', qa.score, 'pack', qp.name),
           qa.completed_at
    from quiz_attempts qa
    join members m on m.user_id = qa.user_id
    left join quiz_packs qp on qp.id = qa.pack_id

    union all
    -- Event plays in this league
    select 'event_result', m.user_id, m.display_name, m.avatar_url,
           jsonb_build_object('score', a.score, 'event', e.title),
           a.completed_at
    from club_event_attempts a
    join club_league_events e on e.id = a.event_id and e.league_id = p_league_id
    join members m on m.user_id = a.user_id
  )
  select * from feed
  order by created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke execute on function get_club_league_feed(uuid, int) from public, anon, authenticated;
grant execute on function get_club_league_feed(uuid, int) to service_role;

-- YourScore Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table if not exists profiles (
  id uuid references auth.users primary key,
  username text unique,
  display_name text,
  avatar_url text,
  social_handle text,
  social_platform text check (social_platform in ('google', 'instagram', 'tiktok')),
  total_score integer default 0,
  games_played integer default 0,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Public profiles readable" on profiles
  for select using (true);

create policy "Users update own profile" on profiles
  for update using (auth.uid() = id);

create policy "Users insert own profile" on profiles
  for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url, social_handle, social_platform)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'user_name',
    new.app_metadata->>'provider'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- MATCHES
-- ============================================================
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  home_team text not null,
  away_team text not null,
  match_date timestamptz not null,
  tournament text default 'FIFA World Cup 2026',
  status text default 'upcoming' check (status in ('upcoming', 'live', 'half_time', 'completed')),
  api_match_id text,
  created_at timestamptz default now()
);

alter table matches enable row level security;

create policy "Matches readable by all" on matches
  for select using (true);

create policy "Matches managed by admins" on matches
  for all using (
    exists (
      select 1 from auth.users
      where id = auth.uid()
      and raw_user_meta_data->>'is_admin' = 'true'
    )
  );

-- ============================================================
-- ROOMS
-- ============================================================
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  match_id uuid references matches(id),
  type text default 'private' check (type in ('private', 'sponsored')),
  sponsor_name text,
  sponsor_logo_url text,
  prize_description text,
  created_by uuid references profiles(id),
  status text default 'lobby' check (status in ('lobby', 'live', 'completed')),
  whatsapp_channel_id text,
  max_players integer default 50,
  created_at timestamptz default now()
);

alter table rooms enable row level security;

create policy "Rooms readable by all" on rooms
  for select using (true);

create policy "Authenticated users create rooms" on rooms
  for insert with check (auth.uid() = created_by);

create policy "Room creator can update" on rooms
  for update using (auth.uid() = created_by);

-- ============================================================
-- ROOM MEMBERS
-- ============================================================
create table if not exists room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid references profiles(id),
  joined_at timestamptz default now(),
  whatsapp_number text,
  notification_consent boolean default false,
  unique(room_id, user_id)
);

alter table room_members enable row level security;

create policy "Room members readable" on room_members
  for select using (true);

create policy "Users join rooms" on room_members
  for insert with check (auth.uid() = user_id);

create policy "Users update own membership" on room_members
  for update using (auth.uid() = user_id);

-- ============================================================
-- QUESTIONS
-- ============================================================
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id),
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer text not null check (correct_answer in ('a', 'b', 'c', 'd')),
  explanation text,
  difficulty text default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  category text check (category in ('player_fact', 'match_history', 'tournament', 'half_time')),
  timing_hint text check (timing_hint in ('pre_match', 'first_half', 'half_time', 'second_half')),
  approved boolean default false,
  created_at timestamptz default now()
);

alter table questions enable row level security;

-- Players can only see approved questions during events (via question_events join)
-- Admins see all
create policy "Approved questions readable" on questions
  for select using (
    approved = true
    or exists (
      select 1 from auth.users
      where id = auth.uid()
      and raw_user_meta_data->>'is_admin' = 'true'
    )
  );

-- ============================================================
-- QUESTION EVENTS
-- ============================================================
create table if not exists question_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id),
  question_id uuid references questions(id),
  fired_at timestamptz default now(),
  closes_at timestamptz not null,
  status text default 'live' check (status in ('live', 'closed')),
  sequence_number integer
);

alter table question_events enable row level security;

create policy "Question events readable by room members" on question_events
  for select using (
    exists (
      select 1 from room_members
      where room_id = question_events.room_id
      and user_id = auth.uid()
    )
    or exists (
      select 1 from rooms
      where id = question_events.room_id
      and created_by = auth.uid()
    )
  );

-- ============================================================
-- ANSWERS
-- ============================================================
create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  question_event_id uuid references question_events(id),
  user_id uuid references profiles(id),
  room_id uuid references rooms(id),
  selected_answer text not null check (selected_answer in ('a', 'b', 'c', 'd')),
  is_correct boolean not null,
  time_taken_ms integer not null,
  points_awarded integer not null,
  answered_at timestamptz default now(),
  unique(question_event_id, user_id)
);

alter table answers enable row level security;

create policy "Users read own answers" on answers
  for select using (auth.uid() = user_id);

create policy "Users insert own answers" on answers
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- ROOM SCORES (materialised leaderboard)
-- ============================================================
create table if not exists room_scores (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id),
  user_id uuid references profiles(id),
  total_score integer default 0,
  correct_answers integer default 0,
  total_answers integer default 0,
  current_streak integer default 0,
  best_streak integer default 0,
  rank integer,
  updated_at timestamptz default now(),
  unique(room_id, user_id)
);

alter table room_scores enable row level security;

create policy "Room scores readable by all" on room_scores
  for select using (true);

create policy "System updates room scores" on room_scores
  for all using (true);

-- ============================================================
-- ADMIN WRITE POLICIES (handled via service role key in API routes,
-- but these allow the service role to bypass RLS cleanly)
-- ============================================================

-- Questions: admins can insert/update (service role bypasses RLS anyway)
create policy "Admins manage questions" on questions
  for all using (
    exists (
      select 1 from auth.users
      where id = auth.uid()
      and raw_user_meta_data->>'is_admin' = 'true'
    )
  );

-- Question events: room creators can insert
create policy "Room creators insert question events" on question_events
  for insert with check (
    exists (
      select 1 from rooms
      where id = question_events.room_id
      and created_by = auth.uid()
    )
  );

-- Rooms: anyone can update status (service role handles this in practice)
create policy "Admins update rooms" on rooms
  for update using (true);

-- ============================================================
-- QUIZ ATTEMPTS (leaderboard)
-- ============================================================
-- NOTE: quiz_attempts table is created via Supabase dashboard.
-- Required RLS policies (run once in SQL editor):
--   CREATE POLICY "Quiz attempts leaderboard readable" ON quiz_attempts FOR SELECT USING (true);
--   CREATE POLICY "quiz_attempts_insert_own" ON quiz_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
--   CREATE POLICY "quiz_attempts_select_own" ON quiz_attempts FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- REALTIME — enable for leaderboard + question events + rooms
-- ============================================================
alter publication supabase_realtime add table room_scores;
alter publication supabase_realtime add table question_events;
alter publication supabase_realtime add table room_members;
alter publication supabase_realtime add table rooms;

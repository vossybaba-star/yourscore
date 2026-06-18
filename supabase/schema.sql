-- schema.sql — REGENERATED from the live database via introspection on 2026-06-04.
-- Source of truth: this reflects the actual production schema (public).
-- Note: regenerated programmatically (not pg_dump); ordering groups tables,
-- then constraints, then RLS policies, then functions.

-- ============================================================
-- TABLES (RLS enabled on each)
-- ============================================================
create table if not exists answers (
  id uuid not null default gen_random_uuid(),
  question_event_id uuid,
  user_id uuid,
  room_id uuid,
  selected_answer text not null,
  is_correct boolean not null,
  time_taken_ms integer not null,
  points_awarded integer not null,
  answered_at timestamp with time zone default now(),
  match_id uuid
);
alter table answers enable row level security;
create table if not exists challenge_attempts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  challenge_id uuid not null,
  score integer not null default 0,
  max_score integer not null default 20,
  completed_at timestamp with time zone,
  answers jsonb,
  created_at timestamp with time zone not null default now()
);
alter table challenge_attempts enable row level security;
create table if not exists challenge_questions (
  id uuid not null default gen_random_uuid(),
  challenge_id uuid not null,
  question_number integer not null,
  difficulty text not null,
  category text,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer text not null,
  created_at timestamp with time zone not null default now()
);
alter table challenge_questions enable row level security;
create table if not exists challenges (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  title text not null,
  team_name text not null,
  league text not null default 'premier-league'::text,
  season text not null default '2025-26'::text,
  question_count integer not null default 20,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);
alter table challenges enable row level security;
create table if not exists device_tokens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  platform text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table device_tokens enable row level security;
create table if not exists fire_queues (
  id uuid not null default gen_random_uuid(),
  match_id uuid not null,
  question_id uuid not null,
  position integer not null default 0,
  created_at timestamp with time zone default now()
);
alter table fire_queues enable row level security;
create table if not exists friendships (
  user_id uuid not null,
  friend_id uuid not null,
  created_at timestamp with time zone default now()
);
alter table friendships enable row level security;
create table if not exists h2h_challenges (
  id uuid not null default gen_random_uuid(),
  quiz_pack_id text not null,
  quiz_pack_name text not null,
  challenger_id uuid not null,
  challenger_name text not null,
  challenger_score integer not null,
  challenger_correct integer not null,
  total_questions integer not null,
  max_score integer not null,
  opponent_id uuid,
  opponent_score integer,
  opponent_correct integer,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default (now() + '7 days'::interval)
);
alter table h2h_challenges enable row level security;
create table if not exists league_members (
  league_id uuid not null,
  user_id uuid not null,
  total_score integer default 0,
  games_played integer default 0,
  joined_at timestamp with time zone default now(),
  questions_attempted integer default 0,
  questions_correct integer default 0,
  current_streak integer default 0,
  best_streak integer default 0
);
alter table league_members enable row level security;
create table if not exists leagues (
  id uuid not null default gen_random_uuid(),
  name text not null,
  code text not null,
  description text,
  created_by uuid,
  created_at timestamp with time zone default now()
);
alter table leagues enable row level security;
create table if not exists match_interests (
  id uuid not null default gen_random_uuid(),
  match_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone default now()
);
alter table match_interests enable row level security;
create table if not exists match_notifications (
  id uuid not null default gen_random_uuid(),
  match_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone default now()
);
alter table match_notifications enable row level security;
create table if not exists match_scores (
  match_id uuid not null,
  user_id uuid not null,
  total_score integer not null default 0,
  correct_answers integer not null default 0,
  total_answers integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  rank integer,
  updated_at timestamp with time zone default now()
);
alter table match_scores enable row level security;
create table if not exists matches (
  id uuid not null default gen_random_uuid(),
  home_team text not null,
  away_team text not null,
  match_date timestamp with time zone not null,
  tournament text default 'FIFA World Cup 2026'::text,
  status text default 'upcoming'::text,
  api_match_id text,
  created_at timestamp with time zone default now(),
  home_score integer default 0,
  away_score integer default 0
);
alter table matches enable row level security;
create table if not exists profiles (
  id uuid not null,
  username text,
  display_name text,
  avatar_url text,
  social_handle text,
  social_platform text,
  total_score integer default 0,
  games_played integer default 0,
  created_at timestamp with time zone default now()
);
alter table profiles enable row level security;
create table if not exists question_events (
  id uuid not null default gen_random_uuid(),
  room_id uuid,
  question_id uuid,
  fired_at timestamp with time zone default now(),
  closes_at timestamp with time zone not null,
  status text default 'live'::text,
  sequence_number integer,
  match_id uuid
);
alter table question_events enable row level security;
create table if not exists questions (
  id uuid not null default gen_random_uuid(),
  entity text not null,
  entity_type text not null,
  question text not null,
  options jsonb not null,
  answer text not null,
  difficulty text not null,
  category text not null,
  era text,
  tags text[] default '{}'::text[],
  status text default 'active'::text,
  source_pack_id uuid,
  created_at timestamp with time zone default now(),
  times_answered integer not null default 0,
  times_correct integer not null default 0,
  verification_note text,
  source text default 'generated'::text
);
alter table questions enable row level security;
create table if not exists quiz_attempts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  pack_id uuid not null,
  score integer not null default 0,
  max_score integer not null default 2000,
  correct_count integer not null default 0,
  answers jsonb,
  completed_at timestamp with time zone not null default now()
);
alter table quiz_attempts enable row level security;
create table if not exists quiz_packs (
  id uuid not null default gen_random_uuid(),
  type text not null,
  name text not null,
  parameter text not null,
  questions jsonb not null,
  question_count integer default jsonb_array_length(questions),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  title text,
  status text not null default 'published'::text,
  source text not null default 'system'::text,
  user_id uuid,
  tags text[] default '{}'::text[],
  difficulty_focus text default 'mixed'::text,
  metadata jsonb default '{}'::jsonb,
  rotation_active boolean default false,
  rotation_order integer,
  created_by uuid,
  is_custom boolean not null default false
);
alter table quiz_packs enable row level security;
create table if not exists rate_limits (
  key text not null,
  count integer not null default 0,
  window_start timestamp with time zone not null default now()
);
alter table rate_limits enable row level security;
create table if not exists room_members (
  id uuid not null default gen_random_uuid(),
  room_id uuid,
  user_id uuid,
  joined_at timestamp with time zone default now(),
  whatsapp_number text,
  notification_consent boolean default false,
  last_seen_at timestamp with time zone default now()
);
alter table room_members enable row level security;
create table if not exists room_scores (
  id uuid not null default gen_random_uuid(),
  room_id uuid,
  user_id uuid,
  total_score integer default 0,
  correct_answers integer default 0,
  total_answers integer default 0,
  current_streak integer default 0,
  best_streak integer default 0,
  rank integer,
  updated_at timestamp with time zone default now()
);
alter table room_scores enable row level security;
create table if not exists rooms (
  id uuid not null default gen_random_uuid(),
  code text not null,
  name text not null,
  match_id uuid,
  type text default 'private'::text,
  sponsor_name text,
  sponsor_logo_url text,
  prize_description text,
  created_by uuid,
  status text default 'lobby'::text,
  whatsapp_channel_id text,
  max_players integer default 50,
  created_at timestamp with time zone default now(),
  is_public boolean default false,
  room_mode text not null default 'group'::text,
  question_count integer not null default 10,
  pack_id uuid,
  category_filter text,
  difficulty_filter text not null default 'mixed'::text,
  questions_json jsonb,
  current_question_idx integer not null default 0,
  question_started_at timestamp with time zone
);
alter table rooms enable row level security;
create table if not exists user_question_history (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  question_id uuid not null,
  entity text not null,
  correct boolean,
  played_at timestamp with time zone default now()
);
alter table user_question_history enable row level security;

-- ============================================================
-- CONSTRAINTS (primary keys, unique, foreign keys)
-- ============================================================

alter table answers add constraint answers_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id);
alter table answers add constraint answers_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);
alter table answers add constraint answers_question_event_id_fkey FOREIGN KEY (question_event_id) REFERENCES question_events(id);
alter table answers add constraint answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
alter table answers add constraint answers_pkey PRIMARY KEY (id);
alter table answers add constraint answers_question_event_id_user_id_key UNIQUE (question_event_id, user_id);
alter table challenge_attempts add constraint challenge_attempts_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE;
alter table challenge_attempts add constraint challenge_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table challenge_attempts add constraint challenge_attempts_pkey PRIMARY KEY (id);
alter table challenge_questions add constraint challenge_questions_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE;
alter table challenge_questions add constraint challenge_questions_pkey PRIMARY KEY (id);
alter table challenges add constraint challenges_pkey PRIMARY KEY (id);
alter table challenges add constraint challenges_slug_key UNIQUE (slug);
alter table device_tokens add constraint device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table device_tokens add constraint device_tokens_pkey PRIMARY KEY (id);
alter table device_tokens add constraint device_tokens_user_id_token_key UNIQUE (user_id, token);
alter table fire_queues add constraint fire_queues_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;
alter table fire_queues add constraint fire_queues_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table fire_queues add constraint fire_queues_pkey PRIMARY KEY (id);
alter table fire_queues add constraint fire_queues_match_id_question_id_key UNIQUE (match_id, question_id);
alter table friendships add constraint friendships_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table friendships add constraint friendships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table friendships add constraint friendships_pkey PRIMARY KEY (user_id, friend_id);
alter table h2h_challenges add constraint h2h_challenges_pkey PRIMARY KEY (id);
alter table league_members add constraint league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table league_members add constraint league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
alter table league_members add constraint league_members_pkey PRIMARY KEY (league_id, user_id);
alter table leagues add constraint leagues_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table leagues add constraint leagues_pkey PRIMARY KEY (id);
alter table leagues add constraint leagues_code_key UNIQUE (code);
alter table match_interests add constraint match_interests_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table match_interests add constraint match_interests_pkey PRIMARY KEY (id);
alter table match_interests add constraint match_interests_match_id_user_id_key UNIQUE (match_id, user_id);
alter table match_notifications add constraint match_notifications_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table match_notifications add constraint match_notifications_pkey PRIMARY KEY (id);
alter table match_notifications add constraint match_notifications_match_id_user_id_key UNIQUE (match_id, user_id);
alter table match_scores add constraint match_scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table match_scores add constraint match_scores_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table match_scores add constraint match_scores_pkey PRIMARY KEY (match_id, user_id);
alter table matches add constraint matches_pkey PRIMARY KEY (id);
alter table profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);
alter table profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table profiles add constraint profiles_username_key UNIQUE (username);
alter table question_events add constraint question_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id);
alter table question_events add constraint question_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);
alter table question_events add constraint question_events_pkey PRIMARY KEY (id);
alter table questions add constraint questions_source_pack_id_fkey FOREIGN KEY (source_pack_id) REFERENCES quiz_packs(id) ON DELETE SET NULL;
alter table questions add constraint questions_pkey PRIMARY KEY (id);
alter table quiz_attempts add constraint quiz_attempts_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES quiz_packs(id) ON DELETE CASCADE;
alter table quiz_attempts add constraint quiz_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table quiz_attempts add constraint quiz_attempts_pkey PRIMARY KEY (id);
alter table quiz_attempts add constraint quiz_attempts_user_id_pack_id_key UNIQUE (user_id, pack_id);
alter table quiz_packs add constraint quiz_packs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table quiz_packs add constraint quiz_packs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table quiz_packs add constraint quiz_packs_pkey PRIMARY KEY (id);
alter table rate_limits add constraint rate_limits_pkey PRIMARY KEY (key);
alter table room_members add constraint room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
alter table room_members add constraint room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
alter table room_members add constraint room_members_pkey PRIMARY KEY (id);
alter table room_members add constraint room_members_room_id_user_id_key UNIQUE (room_id, user_id);
alter table room_scores add constraint room_scores_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id);
alter table room_scores add constraint room_scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
alter table room_scores add constraint room_scores_pkey PRIMARY KEY (id);
alter table room_scores add constraint room_scores_room_id_user_id_key UNIQUE (room_id, user_id);
alter table rooms add constraint rooms_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);
alter table rooms add constraint rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table rooms add constraint rooms_pkey PRIMARY KEY (id);
alter table rooms add constraint rooms_code_key UNIQUE (code);
alter table user_question_history add constraint user_question_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_question_history add constraint user_question_history_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;
alter table user_question_history add constraint user_question_history_pkey PRIMARY KEY (id);
alter table user_question_history add constraint user_question_history_user_id_question_id_key UNIQUE (user_id, question_id);

-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================

create policy "Users insert own answers" on answers for insert to public with check ((auth.uid() = user_id));
create policy "Users read own answers" on answers for select to public using ((auth.uid() = user_id));
create policy "challenge_attempts_insert_own" on challenge_attempts for insert to public with check ((auth.uid() = user_id));
create policy "challenge_attempts_select_own" on challenge_attempts for select to public using ((auth.uid() = user_id));
create policy "challenge_questions_read_all" on challenge_questions for select to public using (true);
create policy "challenges_read_all" on challenges for select to public using (true);
create policy "Users delete own device tokens" on device_tokens for delete to public using ((auth.uid() = user_id));
create policy "Users insert own device tokens" on device_tokens for insert to public with check ((auth.uid() = user_id));
create policy "Users read own device tokens" on device_tokens for select to public using ((auth.uid() = user_id));
create policy "friendships_delete" on friendships for delete to public using ((auth.uid() = user_id));
create policy "friendships_insert" on friendships for insert to public with check ((auth.uid() = user_id));
create policy "friendships_read" on friendships for select to public using (((auth.uid() = user_id) OR (auth.uid() = friend_id)));
create policy "Anyone can read h2h challenges" on h2h_challenges for select to public using (true);
create policy "Authenticated users can create challenges" on h2h_challenges for insert to authenticated with check ((challenger_id = auth.uid()));
create policy "league_members_insert" on league_members for insert to public with check ((auth.uid() = user_id));
create policy "league_members_read" on league_members for select to public using (true);
create policy "leagues_insert" on leagues for insert to public with check ((auth.uid() = created_by));
create policy "leagues_read" on leagues for select to public using (true);
create policy "leagues_update" on leagues for update to public using ((auth.uid() = created_by));
create policy "delete own interest" on match_interests for delete to public using ((auth.uid() = user_id));
create policy "insert own interest" on match_interests for insert to public with check ((auth.uid() = user_id));
create policy "read interests" on match_interests for select to public using (true);
create policy "delete own" on match_notifications for delete to public using ((auth.uid() = user_id));
create policy "insert own" on match_notifications for insert to public with check ((auth.uid() = user_id));
create policy "read own" on match_notifications for select to public using ((auth.uid() = user_id));
create policy "match_scores_read" on match_scores for select to public using (true);
create policy "Matches managed by admins" on matches for all to public using ((EXISTS ( SELECT 1
   FROM auth.users
  WHERE ((users.id = auth.uid()) AND ((users.raw_app_meta_data ->> 'is_admin'::text) = 'true'::text)))));
create policy "Matches readable by all" on matches for select to public using (true);
create policy "Public profiles readable" on profiles for select to public using (true);
create policy "Users insert own profile" on profiles for insert to public with check ((auth.uid() = id));
create policy "Users update own profile" on profiles for update to public using ((auth.uid() = id));
create policy "Question events readable by room members" on question_events for select to public using (((EXISTS ( SELECT 1
   FROM room_members
  WHERE ((room_members.room_id = question_events.room_id) AND (room_members.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM rooms
  WHERE ((rooms.id = question_events.room_id) AND (rooms.created_by = auth.uid()))))));
create policy "Room creators insert question events" on question_events for insert to public with check ((EXISTS ( SELECT 1
   FROM rooms
  WHERE ((rooms.id = question_events.room_id) AND (rooms.created_by = auth.uid())))));
create policy "Questions publicly readable" on questions for select to public using (true);
create policy "Quiz attempts leaderboard readable" on quiz_attempts for select to public using (true);
create policy "quiz_attempts_insert_own" on quiz_attempts for insert to public with check ((auth.uid() = user_id));
create policy "quiz_attempts_select_own" on quiz_attempts for select to public using ((auth.uid() = user_id));
create policy "Quiz packs publicly readable" on quiz_packs for select to public using (true);
create policy "Auth users join rooms" on room_members for insert to public with check ((auth.uid() = user_id));
create policy "Members read own membership" on room_members for select to public using ((auth.uid() = user_id));
create policy "Members read own room" on room_members for select to public using (true);
create policy "Users join rooms" on room_members for insert to public with check ((auth.uid() = user_id));
create policy "Users update own membership" on room_members for update to public using ((auth.uid() = user_id));
create policy "Room scores readable by all" on room_scores for select to public using (true);
create policy "Anyone can read player rooms" on rooms for select to public using (true);
create policy "Auth users create rooms" on rooms for insert to public with check ((auth.uid() = created_by));
create policy "Authenticated users create rooms" on rooms for insert to public with check ((auth.uid() = created_by));
create policy "Host can update own room" on rooms for update to public using ((auth.uid() = created_by));
create policy "Room creator can update" on rooms for update to public using ((auth.uid() = created_by)) with check ((auth.uid() = created_by));
create policy "Rooms readable by all" on rooms for select to public using (true);
create policy "Users manage own history" on user_question_history for all to public using ((auth.uid() = user_id));

-- ============================================================
-- FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare
  v_count integer;
begin
  insert into rate_limits (key, count, window_start)
    values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else rate_limits.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, display_name, avatar_url, notifications_opt_in)
  values (
    new.id,
    -- Privacy by default: first name only (see migration 46).
    coalesce(
      nullif(split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1), ''),
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    -- Notifications consent from signup (migration 50).
    coalesce((new.raw_user_meta_data->>'notifications_opt_in')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.increment_profile_score(p_user_id uuid, p_points integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ BEGIN UPDATE profiles SET total_score = COALESCE(total_score, 0) + p_points WHERE id = p_user_id; END; $function$
;
CREATE OR REPLACE FUNCTION public.increment_question_stats(question_ids uuid[], correct_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ BEGIN UPDATE questions SET times_answered = times_answered + 1 WHERE id = ANY(question_ids); UPDATE questions SET times_correct = times_correct + 1 WHERE id = ANY(correct_ids); END; $function$
;
CREATE OR REPLACE FUNCTION public.set_quiz_packs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.update_league_member_stats(p_user_id uuid, p_points integer, p_is_correct boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ BEGIN UPDATE league_members SET total_score = COALESCE(total_score, 0) + p_points, questions_attempted = COALESCE(questions_attempted, 0) + 1, questions_correct = COALESCE(questions_correct, 0) + (CASE WHEN p_is_correct THEN 1 ELSE 0 END) WHERE user_id = p_user_id; END; $function$
;

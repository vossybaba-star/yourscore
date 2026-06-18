-- 50_notifications_consent.sql
-- Notifications opt-in: at signup the user ticks (or not) to be notified when games are
-- running and it's their turn to play. The consent rides in signUp user_metadata;
-- handle_new_user copies it to profiles.notifications_opt_in. Default false = no
-- notifications until explicitly opted in (also the default for OAuth signups, who don't
-- see the checkbox — they can opt in later in Settings). Gates future push/notification sends.

alter table public.profiles add column if not exists notifications_opt_in boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, display_name, avatar_url, notifications_opt_in)
  values (
    new.id,
    -- Privacy by default: first name only (migration 46).
    coalesce(
      nullif(split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1), ''),
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    coalesce((new.raw_user_meta_data->>'notifications_opt_in')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

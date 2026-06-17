-- 46_profile_display_name_default.sql
-- Privacy by default: new accounts default their public display name to the FIRST name
-- only (not the full "First Last" from Google / OAuth metadata). Users can set any
-- display name in Settings. Only affects NEW signups (the trigger runs on auth.users
-- insert); existing names are untouched — they're nudged to choose via an in-app prompt.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      -- first word of the OAuth full name / name, if present…
      nullif(split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1), ''),
      -- …otherwise the email local-part.
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

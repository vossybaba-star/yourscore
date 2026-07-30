-- 221_comment_replies.sql — IG-style replies on discussion threads.
-- ADDITIVE. One nullable self-FK column; depth (two levels) and same-subject
-- rules enforced structurally by trigger, not just in the API.
-- fantasy_league chat (mig 209) inserts parent_id NULL — trigger early-returns.

begin;

alter table comments
  add column if not exists parent_id uuid references comments(id) on delete cascade;

-- reply fetch: all live replies for a page of parents
create index if not exists comments_parent_idx
  on comments (parent_id, created_at asc)
  where deleted_at is null and parent_id is not null;

-- top-level page WITHOUT the deleted filter (tombstone parents must surface);
-- the old partial index (where deleted_at is null) can't serve this query.
create index if not exists comments_subject_toplevel_idx
  on comments (subject_type, subject_id, created_at desc)
  where parent_id is null;

create or replace function comments_validate_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select id, parent_id, subject_type, subject_id, deleted_at
    into p
    from public.comments
    where id = new.parent_id;
  if p.id is null then
    raise exception 'reply parent does not exist' using errcode = '23514';
  end if;
  if p.parent_id is not null then
    raise exception 'replies are one level deep, reply to the top comment' using errcode = '23514';
  end if;
  if p.deleted_at is not null then
    raise exception 'cannot reply to a deleted comment' using errcode = '23514';
  end if;
  if p.subject_type <> new.subject_type or p.subject_id <> new.subject_id then
    raise exception 'reply must share its parent''s subject' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- default EXECUTE goes to PUBLIC — revoke (mig 94/212 hygiene pattern)
revoke all on function comments_validate_reply() from public;

drop trigger if exists comments_validate_reply_trg on comments;
create trigger comments_validate_reply_trg
  before insert or update of parent_id on comments
  for each row execute function comments_validate_reply();

commit;

-- 44_draft_wc_run_comments.sql
-- Social layer on the World Cup board: comments on a player's daily ranked result/squad.
-- WC-ONLY. Server-only table (service role); RLS on with no policies. Soft-delete via
-- deleted_at. Reads go through definer RPCs (joined to profiles for author name/avatar).

begin;

create table if not exists wc_run_comments (
  id         uuid        primary key default gen_random_uuid(),
  run_id     uuid        not null references draft_wc_runs(id) on delete cascade,
  author_id  uuid        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists wc_run_comments_run_idx    on wc_run_comments (run_id, created_at);
create index if not exists wc_run_comments_author_idx on wc_run_comments (author_id);

alter table wc_run_comments enable row level security;  -- service-role only; no policies

-- Every (non-deleted) comment on a given player's ranked runs, with author name/avatar,
-- oldest first — powers the per-run threads on the board drill-down.
create or replace function get_wc_run_comments(p_user uuid)
returns table (id uuid, run_id uuid, author_id uuid, author_name text, author_avatar text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.run_id, c.author_id,
    coalesce(nullif(p.display_name, ''), 'Player') as author_name, p.avatar_url as author_avatar,
    c.body, c.created_at
  from wc_run_comments c
  join draft_wc_runs r on r.id = c.run_id
  left join profiles p on p.id = c.author_id
  where r.user_id = p_user and c.deleted_at is null
  order by c.created_at asc;
$$;
grant execute on function get_wc_run_comments(uuid) to anon, authenticated;

-- Comment counts per player over the ranked season window — for the 💬 badge on the board.
create or replace function get_wc_comment_counts(p_start date, p_end date)
returns table (user_id uuid, comments int)
language sql stable security definer set search_path = public as $$
  select r.user_id, count(*)::int as comments
  from wc_run_comments c
  join draft_wc_runs r on r.id = c.run_id
  where c.deleted_at is null and r.ranked and r.run_date between p_start and p_end
  group by r.user_id;
$$;
grant execute on function get_wc_comment_counts(date, date) to anon, authenticated;

commit;

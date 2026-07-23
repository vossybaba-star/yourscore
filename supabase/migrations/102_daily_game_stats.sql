-- Today's Game tile stats (home hero).
--
-- The hero tile is split: cover art on top, three live numbers underneath —
-- how many have played it, the average score, and how brutal the hardest
-- question turned out to be. Aggregating in SQL keeps the home render to one
-- round trip and avoids pulling every attempt row (PostgREST caps reads at
-- 1000 anyway, which would silently skew the average on a busy day).
--
-- Both functions are read-only aggregates over data that is already public in
-- spirit (crowd stats, never a per-player row and never an answer), so they are
-- security definer and executable by anon — the logged-out marketing hero shows
-- the same numbers.
--
-- NOTE (numbering): 101 is taken twice already (101_daily_games.sql,
-- 101_wc_quiz_thanks.sql) — this is 102.

-- ── Quiz packs ───────────────────────────────────────────────────────────────
-- quiz_attempts.answers is the server-graded log written by
-- /api/quiz/solo-complete: [{ idx, selected, correct, points, elapsed_ms }].
-- `idx` indexes quiz_packs.questions, which is a stable order for a given pack,
-- so per-index aggregation is meaningful across attempts.
create or replace function public.get_daily_pack_stats(p_pack_id uuid)
returns table (
  players             bigint,
  avg_score           numeric,
  hardest_idx         int,
  hardest_correct_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select score, answers
    from quiz_attempts
    where pack_id = p_pack_id
  ),
  per_q as (
    select
      (e->>'idx')::int as idx,
      count(*)::numeric as asked,
      count(*) filter (where (e->>'correct')::boolean)::numeric as got
    from a, lateral jsonb_array_elements(a.answers) e
    where jsonb_typeof(a.answers) = 'array'
    group by 1
  ),
  worst as (
    select idx, got / nullif(asked, 0) as pct
    from per_q
    order by got / nullif(asked, 0) asc nulls last, idx asc
    limit 1
  )
  select
    (select count(*)::bigint from a),
    (select round(avg(score)) from a),
    (select idx from worst),
    (select round(pct * 100) from worst);
$$;

-- ── Perfect 10 ───────────────────────────────────────────────────────────────
-- p10_attempts.found is [{ rank, display, surname, points, hintsUsed }] — the
-- rungs that player actually got. The "hardest question" is the rung the fewest
-- players found, so rungs nobody reached must count as zero: generate_series
-- supplies all ten, the left join fills in the hits.
--
-- Only finished attempts count. An abandoned run has a truncated `found` list
-- through no fault of the question, which would make every late rung look
-- impossible.
create or replace function public.get_daily_p10_stats(p_list_id uuid)
returns table (
  players             bigint,
  avg_score           numeric,
  hardest_rank        int,
  hardest_correct_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select score, found
    from p10_attempts
    where list_id = p_list_id and done
  ),
  n as (select count(*)::numeric as c from a),
  hits as (
    select (e->>'rank')::int as rnk, count(*)::numeric as got
    from a, lateral jsonb_array_elements(a.found) e
    where jsonb_typeof(a.found) = 'array'
    group by 1
  ),
  worst as (
    select r.rnk, coalesce(h.got, 0) as got
    from generate_series(1, 10) as r(rnk)
    left join hits h on h.rnk = r.rnk
    order by coalesce(h.got, 0) asc, r.rnk asc
    limit 1
  )
  select
    (select c::bigint from n),
    (select round(avg(score)) from a),
    (select rnk from worst),
    case when (select c from n) = 0 then null
         else round((select got from worst) * 100.0 / (select c from n)) end;
$$;

grant execute on function public.get_daily_pack_stats(uuid) to anon, authenticated, service_role;
grant execute on function public.get_daily_p10_stats(uuid)  to anon, authenticated, service_role;

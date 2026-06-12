# Club Leagues — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-12-club-leagues-design.md`
**Date:** 2026-06-12

Existing code to lean on:
- `src/app/api/quiz/solo-complete/route.ts` — the template for event grading: auth →
  rate limit → first-attempt-only check → server-side grade from authoritative
  questions → insert with 23505 race guard.
- `src/app/challenges/[slug]/page.tsx` — the solo quiz play UI (30s window, optimistic
  client points, server-graded save). Event play mirrors its runner.
- `supabase/migrations/30_yourscore_points.sql` — `get_yourscore_leaderboard(p_user_ids, p_limit)`
  already filters by member ids; the overall board is one RPC call.
- `src/lib/scoring.ts` — quiz scoring (shared with solo-complete).
- `src/lib/ratelimit.ts` — `rateLimitDistributed`.
- `14_draft_xi.sql` — RLS style for league/member tables.

## Phase 1 — Migration `supabase/migrations/35_club_leagues.sql`

1. `club_leagues`, `club_league_members`, `club_league_events`, `club_event_attempts`
   per spec §3 (events carry `questions` jsonb snapshot; attempts `unique(event_id, user_id)`).
2. RLS: members read league/members/events/attempts; owner updates branding columns only
   (separate update policy; slug/tier/is_active excluded via a trigger or column-level
   check in API — API-enforced, owner update policy still row-scoped). Inserts/deletes
   via service role (no anon/auth insert policies).
3. `get_club_league_feed(p_league_id uuid, p_limit int)` — security definer RPC, union of:
   member joins, members' recent `draft_live_matches` results, members' `quiz_attempts`
   completions, `club_event_attempts` results. Returns (kind, user_id, display_name,
   avatar_url, detail jsonb, created_at).
4. Indexes: members by user_id; events by league_id, starts_at; attempts by event_id, score.

**Do NOT apply to prod in this session without explicit founder approval** (house rule —
migrations go via Supabase CLI after sign-off).

## Phase 2 — Types

Hand-add the four tables + RPC to `src/types/database.ts` (generated types are already
known-stale; regenerate after the migration is applied).

## Phase 3 — API routes (`src/app/api/club/…`)

- `GET /api/club/[slug]` — service-role lookup. Non-member/anon: branding fields +
  member count only. Member: full hub payload in one response — league, role, events
  (with derived live/ended), overall board (`get_yourscore_leaderboard` over member ids),
  feed (`get_club_league_feed`).
- `POST /api/club/[slug]/join` — auth required; validates `is_active`; idempotent;
  rate-limited.
- `POST /api/club/[slug]/events` — owner only; validates pack ownership + published
  status; snapshots `questions` onto the event row. `PATCH …/events/[id]` — cancel/edit
  title/window/prize (no questions edit after creation).
- `POST /api/club/events/[id]/attempt` — mirrors solo-complete: auth → rate limit →
  membership → window open → first-attempt-only → grade from event snapshot via
  `src/lib/scoring.ts` → insert with 23505 guard.
- `PATCH /api/club/[slug]` — owner branding/welcome/prize/announcement edits
  (whitelisted columns).
- Admin: `POST/GET/PATCH /api/admin/club-leagues` — create (name/slug/tier, owner by
  email lookup), list, deactivate. Guard with the existing admin auth pattern.

## Phase 4 — UI

- `src/app/l/[slug]/page.tsx` — landing (anon/non-member: cover/logo/welcome/prize/member
  count + "Join the club" CTA → sign-in → auto-join) and hub (member: branded header,
  pinned announcement, tabs **Board / Events / Feed**, + **Manage** tab for owner:
  branding form, event create, QR + join-link card, member count).
- `src/app/l/[slug]/event/[eventId]/play/page.tsx` — quiz runner over the event snapshot,
  submitting to the attempt endpoint; outside window / already played → event board view.
- `src/app/admin/club-leagues/page.tsx` — provisioning UI.
- `src/app/leagues/page.tsx` — add "Club Leagues" section listing the user's club leagues.
- QR: render via a tiny client-side QR component on the Manage tab (no new heavy dep if
  one exists; otherwise smallest maintained lib).

## Phase 5 — Tests & verification

- Unit tests (match repo's existing test setup if present; otherwise script-style checks
  like the engine verifications): grading parity with solo-complete, window rejection,
  duplicate rejection, non-member rejection.
- RLS probes (SQL): anon/member/non-member/owner on all four tables.
- Manual preview run-through: admin-provision → public landing → join (second account) →
  create event → play → boards + feed render.

## Phase 6 — Ship follow-ups (separate, after founder applies migration)

- Apply migration 35 via Supabase CLI (founder approval).
- Update `YOURSCORE.md`: add Club League to glossary + new section; mark roadmap
  "Pub Leagues" delivered-by Club Leagues; bump Confirmed date. Run `graphify update .`.

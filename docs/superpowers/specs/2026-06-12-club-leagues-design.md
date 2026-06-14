# Club Leagues — Design Spec

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Locked term:** **Club League** — a partner-owned, branded league + community space.
("Custom league" continues to mean the existing user-created 38-0 leagues; do not conflate.)

## 1. What it is

A Club League is a branded space inside YourScore that an external partner — a pub/venue,
a creator, or a sponsor — owns and runs for their community. It gives the partner:

1. An **always-on overall board**: the YourScore Rank table scoped to the league's members
   ("where do I stand against the other punters in this pub").
2. **Quiz events** they run themselves (the classic pub quiz night), each with its own
   leaderboard.
3. A **branded hub** with their logo, colours, welcome text, prize text, a pinned
   announcement, and an auto-generated **activity feed**.

This delivers the roadmap's "Pub Leagues" (YOURSCORE.md §8) generalised to all three
partner personas. It supersedes the shelved "sponsored rooms" concept (which stays
shelved — its vestigial `rooms.sponsor_*` columns are untouched and unused).

**Commercials (v1):** free for pubs and creators (they're distribution); sponsors pay via
manually-invoiced deals. **No in-app billing.** The `tier` field is reporting only.

## 2. Architecture decision

**Approach A — new first-class system.** Club Leagues get their own tables and routes,
fully separate from `draft_leagues` (38-0 friend leagues) and `leagues` (Quiz leagues),
which are per-game, minimal, and serve a different product. Rationale:

- The overall board is cross-game and already cheap: `get_yourscore_leaderboard(p_user_ids)`
  (migration 30) accepts a member-id filter. Read-time only, zero new scoring writes,
  identical numbers to the global `/leaderboard`.
- Partner features (branding, slugs, events, feed, roles) never tangle with friend-group
  league plumbing.

Rejected: extending existing league tables (bolts a different product onto 4-column
tables); reviving sponsored Lobbies (ephemeral games ≠ persistent community space; 20-player
Public Lobby cap is too small for a venue; model was already shelved).

## 3. Data model — migration `38_club_leagues.sql`

All tables RLS-enabled; writes server-authoritative (service role) per house pattern.

### `club_leagues`
| column | notes |
|---|---|
| `id` uuid pk | |
| `slug` text unique | join URL `yourscore.app/l/<slug>`; printed on posters/QR — **locked after creation** (admin-only change) |
| `name` text | |
| `owner_id` uuid → auth.users | the partner's normal user account |
| `tier` text | `'pub' \| 'creator' \| 'sponsor'` — reporting only, no behaviour difference |
| `logo_url`, `cover_url`, `brand_color` | branding; all nullable with branded defaults |
| `welcome_text`, `prize_text` | landing + hub copy |
| `announcement` text | single pinned message, partner-editable (deliberately not a table) |
| `join_code` text unique | alternative to slug link |
| `is_active` boolean | admin kill switch; inactive → 404 |
| `created_at` | |

### `club_league_members`
`(league_id, user_id)` pk, `role 'owner' | 'member'`, `joined_at`.
(`manager`/staff role deferred.)

### `club_league_events`
`id`, `league_id`, `title`, `description`, `pack_id → quiz_packs`,
`questions` jsonb (**snapshot of the pack's questions at creation** — a partner deleting
or editing the pack cannot break a live quiz night), `starts_at`, `ends_at`,
`prize_text`, `status` (`'scheduled' | 'cancelled'` — live/ended are *derived* from the
window, not stored), `created_by`, `created_at`.

### `club_event_attempts`
`id`, `event_id`, `user_id`, `score`, `max_score`, `answers` jsonb, `completed_at`,
**`unique(event_id, user_id)`** — one attempt per member per event.

### RLS sketch
- `club_leagues`: members read full row; **public read of branding fields happens via a
  service-role slug lookup in the landing-page API**, not via an RLS policy; owner updates
  branding/welcome/prize/announcement only (not slug/tier/is_active).
- `club_league_members`: members read the member list; insert/delete via API.
- `club_league_events`: members read; owner manages, via API.
- `club_event_attempts`: members read (event boards are league-visible); insert via
  service role only (server grading).

## 4. Scoring & boards

1. **Overall board** — `get_yourscore_leaderboard(p_user_ids := <league member ids>)`.
   Same YourScore points as everywhere (Knowledge + Match, win 1,500 / draw 500); strict
   positions within the league; same cosmetic badges as `/leaderboard`.
2. **Event board** — `club_event_attempts` for the event, ranked by `score` desc,
   earlier `completed_at` breaking ties.

**Decision: event attempt points count ONLY on the event board.** They do NOT feed
`challenge_attempts`, `profiles.total_score`, or YourScore points. Partner-authored packs
feeding the global ranking is an integrity hole (easy questions ⇒ free global points),
and the leaderboard brand is "verified — real results only". Punters climb the pub's
overall board through normal play. Revisit only with vetting/caps designed first.

Event grading reuses the quiz scoring lib (`points = 100 × difficulty × speed`, standard
speed bands), recomputed server-side from the event's snapshotted questions.

## 5. Surfaces & flows

### Public landing — `/l/[slug]`
Cover, logo, name, welcome text, prize text, member count, one CTA: **"Join the club"**.
Signed-in → instant join. Guest → existing sign-in flow → auto-join → hub. Publicly
readable cold (branding only). Unknown/inactive slug → 404.

### Member hub — same route for members
Branded header (cover, logo, brand colour accent), pinned announcement, three tabs:
- **Board** — league-scoped YourScore table, own row highlighted.
- **Events** — live event first (prominent "Play now" within window), then upcoming, then
  past with final boards + winners.
- **Feed** — read-time RPC (`get_club_league_feed(league_id, limit)`): union of recent
  member activity — joins, 38-0 Live H2H results, solo challenge completions, event
  results. No feed writes, no user-generated content, no moderation surface.

### Event play — `/l/[slug]/event/[id]/play`
Standard quiz UI over the event's snapshotted questions; server grades and writes the one
attempt. Outside window / already played → redirect to the event board.

### Partner manage — "Manage" tab on the hub (owner only)
Edit branding/welcome/prize/announcement; create events (choose own quiz pack or link to
`/quiz/create` to build one); member count; printable QR + join-link card.
**Partners never access `/admin`.**

### Admin — `/admin/club-leagues`
Create league (name, slug, tier), assign owner by email, edit slug, deactivate.

### Navigation
Existing **Leagues** tab gains a "Club Leagues" section listing the user's club leagues.
No new bottom-nav tab.

### API routes (server-authoritative)
- `GET /api/club/[slug]` — landing data (public, branding only) / hub data (member).
- `POST /api/club/[slug]/join` — validates `is_active`; rate-limited.
- `POST /api/club/events` · `PATCH /api/club/events/[id]` — owner only.
- `POST /api/club/events/[id]/attempt` — validates membership, window, uniqueness;
  grades server-side; rate-limited.
- `GET` board/feed via the two RPCs.

## 6. Error handling & integrity

- Client never trusted: membership, window, uniqueness, and grading all enforced
  server-side; unique constraint is the backstop for double submits.
- Rate limiting via existing `check_rate_limit` on join + attempt.
- Slug immutable to partners (printed posters); admin can correct.
- Pack snapshot on event creation (see §3) — live events immune to pack edits/deletes.
- Member leaves → attempts/history retained (the pub's record); they drop off boards.
- Fail soft: feed RPC failure doesn't block hub render; missing branding assets fall back
  to YourScore defaults (initial-letter logo, default colours).

## 7. Testing

- Unit: event grading path (scoring lib reuse), window rejection, duplicate-attempt
  rejection, non-member rejection.
- RLS: SQL probes — member vs non-member vs owner vs anon reads on all four tables.
- Manual preview run-through: provision via admin → join via public link as a second
  account → run a 2-person event end-to-end → verify both boards + feed.

## 8. Out of scope for v1 (explicit deferrals, not omissions)

- League chat / DMs (feed + reactions is the next step if wanted)
- 38-0 event types (38-0 still counts in the overall board)
- In-app billing / payments
- `manager`/staff roles
- Partner analytics dashboards
- Brand bleed into game screens ("brought to you by…" overlays, branded result graphics)
- True white-label

## 9. Follow-ups on ship

Update `YOURSCORE.md` (new §: Club Leagues; add "Club League" to the locked glossary;
mark roadmap "Pub Leagues" as delivered-by Club Leagues; bump Confirmed date) and run
`graphify update .`.

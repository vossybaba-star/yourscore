# Async Multiplayer — Phase 1 Implementation Plan

Plan for the design at `docs/superpowers/specs/2026-06-29-async-multiplayer-phase1-design.md`.
Ordered, each step independently shippable + verifiable. **Web track ships via normal deploy; the Native track needs one TestFlight rebuild and runs in parallel.**

Convention each step: build → `next build` green (ESLint gate) → verify → commit → deploy (cherry-pick onto `origin/main`, build-verified).

---

## WEB TRACK (ships now)

### Step 0 — DB migration: extend `h2h_challenges`
- `supabase/migrations/55_h2h_async.sql`:
  - add `invited_user_id uuid references auth.users(id) on delete set null`, `status text not null default 'awaiting_opponent'`, `seen_by_opponent boolean not null default false`.
  - indexes: `(invited_user_id, status)`, `(challenger_id, created_at desc)`.
  - **backfill** existing rows' `status`: `complete` where `opponent_score is not null`; else `expired` where `now() > expires_at`; else `awaiting_opponent`.
  - RLS: keep public `select`; add `delete`/`update` none (server-only stays). Add a narrow `update` policy allowing the `invited_user_id` to set only `seen_by_opponent` — or do it via the service-role `/api/h2h/seen` (preferred, no broad policy).
- Update `src/types/database.ts` (`h2h_challenges` Row/Insert/Update) for the new columns.
- **Apply to prod** via Management API (user-authorized; additive + backfill, safe). Verify columns + a sample status backfill.
- Verify: query prod confirms columns + indexes + backfilled statuses.

### Step 1 — Server: create, status, guards
- `POST /api/h2h/create` (new; replaces the client-side insert in `challenges/[slug]`): inserts the challenge from the authed challenger's just-played score + optional `invited_user_id`; returns `{ id }`. Centralising creation lets it also fire notifications (Step 6) and later push. RLS insert policy already restricts `challenger_id = auth.uid()`.
- `/api/h2h/play` (extend): on opponent submit set `status='complete'`; **reject** when `invited_user_id is not null and != auth.uid()` → 403 "this challenge is for someone else". Keep the existing `.is("opponent_score", null)` race guard.
- `POST /api/h2h/seen` (new, service-role): assert caller `== invited_user_id`, set `seen_by_opponent = true`.
- Verify: curl the routes (auth-gated paths return 401/403 as expected); unit-drive create + play with a test account.

### Step 2 — Inbox data + badge hook
- `src/hooks/useYourTurns.ts`: returns `{ yourTurn[], waiting[], results[] }` from `h2h_challenges` joined to `profiles` (challenger/opponent names + avatars).
- `src/hooks/usePendingTurns.ts`: count of `invited_user_id = me and status = awaiting_opponent and not seen_by_opponent` (mirror `usePendingFriends`).
- Wire `usePendingTurns` into `BottomNav` as a badge on the Play/Quiz tab.
- Verify: mock-harness route renders all states from fixture data (deleted before commit).

### Step 3 — Your-Turns inbox = new MP home
- Rebuild the **multiplayer** surface of `src/app/play/page.tsx` as the inbox: **Your turn** (primary, badge) · **Waiting on them** · **Results** (with Rematch) · **New challenge** CTA · **Play live** (secondary — links to existing lobby create/join, unchanged).
- Keep `play/[roomId]` + `/api/room/*` untouched; only move the entry point.
- Verify: mock-harness screenshots of populated + empty states; `/play` 200.

### Step 4 — Challenge entry points
- **Friends list** (`src/app/friends/page.tsx`): add a **Challenge** button per accepted friend → opens a quiz-picker sheet → on pick, route to `/challenges/[slug]?challenge=<friendId>`.
- **Post-result** (`src/app/challenges/[slug]/page.tsx`): the existing "Challenge a friend" reads `?challenge=` to pre-target (calls `/api/h2h/create` with `invited_user_id`), else offers **pick a friend** (targeted) or **share link** (open).
- (Quiz-pack "Challenge a mate" affordance — optional, defer if needed.)
- Verify: drive friends-list → picker → play → challenge created (test account).

### Step 5 — Native-feel share (no rebuild)
- Challenge share uses `navigator.share({ text, url })` when available (works in iOS WKWebView), fallback to copy + the existing WhatsApp link. Apply on `/h2h/[id]` ShareCard + the inbox "share again."
- Verify: share invoked in browser preview (capability check).

### Step 6 — Notifications (web)
- Email on **targeted** create: `src/lib/email/senders.ts` "X challenged you on [pack] — beat their score", gated on `profiles.notifications_opt_in`. **Best-effort** (transactional quota risk — log, don't fail the challenge).
- In-app: inbox badge (Step 2) + a Dashboard home-feed nudge ("Marcus is waiting on your move").
- Verify: email send logged in a test; nudge renders via mock-harness.

### Step 7 — Expiry cron
- `src/app/api/cron/expire-challenges/route.ts` (mirror `cleanup-lobbies`): flip `awaiting_opponent` past `expires_at` → `expired`. Register in `vercel.json` (daily).
- Verify: auth-gate 401; the update query dry-checked.

---

## NATIVE TRACK (one TestFlight rebuild, parallel)

### Step N1 — Haptics
- Add `@capacitor/haptics`; light tap on answer select, success/warning on correct/wrong, heavy on win (QuestionCard / AnswerButtons / result cards), all behind `isNative()`.

### Step N2 — Push delivery
- Finish the blocked token wiring (see iOS-push memory); server sends "your turn" (on targeted create), "Marcus beat your score" (on complete), "expires tonight" (cron). Gate on `notifications_opt_in`.

### Step N3 — Universal Links
- `apple-app-site-association` + entitlements so `/h2h/[id]` and challenge links open the app into the game.

> N1–N3 ride a single rebuild. The web track (Steps 0–7) delivers the full async loop on the existing app via the webview before the rebuild lands; native polish lights up after.

---

## Out of scope (Phases 2–3)
Group / N-participant challenges + daily-vs-friends (`challenge_participants`), Live Activities / Dynamic Island, Capacitor Contacts, app-badge via push, usernames/handles.

## Suggested build order
0 → 1 → 2 → 3 → 4 → 6 → 5 → 7, then ship the web track; N1–N3 batched into the next iOS rebuild. Each web step is its own commit + build-verified deploy.

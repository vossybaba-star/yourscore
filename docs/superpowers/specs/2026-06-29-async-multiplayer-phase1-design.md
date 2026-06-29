# Async Multiplayer — Phase 1 Design

**Date:** 2026-06-29
**Scope:** Async 1v1 challenges, a "Your Turns" inbox, a cleaner multiplayer home, and the native-app layer — Phase 1 of a phased multiplayer rethink for the native iOS app.

---

## 1. Goal & context

YourScore's multiplayer today is two disconnected things:

- A **synchronous lobby quiz** (`/play/[roomId]`, `rooms`/`room_scores`) — Kahoot-style, everyone online at once. Great in a pub, hard to coordinate as a friend-group app.
- An **async 1v1 challenge** (`h2h_challenges`, `/h2h/[id]`) — already working: finish a quiz → "Challenge a friend" → share a `/h2h/{id}` link → opponent plays on their own time → server grades → results compile (7-day expiry, race-safe via `.is("opponent_score", null)`).

The async 1v1 *game and scoring are done*. What's missing is the **social + native layer** that makes it feel like a real mobile app: targeting a specific friend, an inbox so you know it's your turn, notifications, and native polish. The synchronous lobby stays as a "when you're together" option, de-emphasised.

**Decision (locked with founder):** extend the working `h2h_challenges` table rather than build a generic N-participant engine now. Phase 2 (groups, daily-vs-friends) adds a participants table and the inbox unions both. Model is async-default, live-as-an-option; challenge shape is 1v1 first.

**Success criteria:** a player can challenge a named friend (or open link) to a quiz, the friend sees "your turn" in an inbox, both play on their own time, and both see a result — with a clean MP home and native-feeling share. No 2-player real-time coordination required.

---

## 2. The async 1v1 loop (Phase 1)

```
Challenger picks a friend (or "open link") + a quiz pack
   → plays the quiz (sets the score to beat)            [challenger plays FIRST — matches the engine]
   → h2h_challenges row created (challenger score + optional invited_user_id)
   → Invited friend: appears in their "Your Turns" inbox + notification (in-app/email; push later)
        Open-link: shared via native share sheet (navigator.share)
   → Opponent opens (inbox tap or link) → /h2h/[id] → plays
   → /api/h2h/play grades → status = complete
   → Both see result card ("Marcus beat your 8,200" / "You held them off")
   → "Run it back" → creates a fresh challenge
```

The challenger always plays first (the engine stores `challenger_score`); this is natural — you set the bar, they chase it.

---

## 3. Data model — extend `h2h_challenges`

```sql
alter table h2h_challenges
  add column if not exists invited_user_id uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'awaiting_opponent',
  add column if not exists seen_by_opponent boolean not null default false;

create index if not exists h2h_challenges_invited_idx   on h2h_challenges (invited_user_id, status);
create index if not exists h2h_challenges_challenger_idx on h2h_challenges (challenger_id, created_at desc);
```

- **`invited_user_id`** — the targeted friend. **Null = open-link challenge** (anyone with the link can accept — the existing behaviour). **Set = targeted** (surfaces in that friend's inbox; only that user may accept — enforced in `/api/h2h/play`). This is the clean "both" semantic: targeted (friend, inbox) vs open (link, anyone).
- **`status`** — `awaiting_opponent` | `complete` | `expired` (declined deferred to a later phase). Derivable from `opponent_score`+`expires_at` today, but an explicit column keeps the inbox query simple and indexable. A daily cron (reuse the cleanup-lobbies pattern) flips past-expiry `awaiting_opponent` rows to `expired`.
- **`seen_by_opponent`** — drives the inbox unread badge; set when the invited friend opens the challenge.

**RLS:** existing `select … using (true)` (public read for links) stays. Writes remain server-only via `/api/h2h/play`. Two narrow additions:
- `/api/h2h/play` rejects when `invited_user_id` is set and `!= auth.uid()` ("this challenge is for someone else").
- A tiny `POST /api/h2h/seen` (service-role, asserts caller == `invited_user_id`) flips `seen_by_opponent` — no broad client UPDATE policy.

---

## 4. Entry points (challenge creation)

1. **Friends list** (`/friends`) — add a **Challenge** button per friend row (next to Message). → quiz picker → play → creates a targeted challenge (`invited_user_id` = friend). This is the headline new path.
2. **Post-result** (`/challenges/[slug]`, existing "Challenge a friend") — now offers **pick-a-friend** (targeted) *or* **share link** (open), instead of share-only.
3. **Quiz pack card / `/play`** — a "Challenge a mate" affordance → pick friend or open → play → send.

All three converge on the same create call: insert an `h2h_challenges` row with the challenger's graded score and an optional `invited_user_id`.

---

## 5. The "Your Turns" inbox = the new multiplayer home

The `/play` Multiplayer surface is **rebuilt as the inbox** (this is the "make it cleaner" answer — it replaces the lobby-list + 3-step create-wizard clutter):

- **Your turn** — incoming targeted challenges (`invited_user_id = me`, `status = awaiting_opponent`). Primary section, drives the badge. Each row: challenger avatar, "Marcus challenged you · Arsenal All-Time · 8,200 to beat", **Play** CTA.
- **Waiting on them** — challenges I created, `awaiting_opponent`. Shows opponent (or "open link · share again").
- **Results** — recently `complete`, win/loss styled, with **Rematch**.
- **New challenge** — prominent CTA → pick friend (or open) + quiz.
- **Play live** — the synchronous lobby, kept but as a **secondary** action (one tap to create/join a live room). Not deleted; just no longer the front door.

**Bottom-nav badge:** a `usePendingTurns` hook (mirrors the existing `usePendingFriends`) puts a count on the Play/Quiz tab = number of "your turn" items.

---

## 6. Notifications

**Phase 1 (web-deployable, no rebuild):**
- **In-app:** inbox section + bottom-nav badge + a one-line home-feed nudge ("Marcus is waiting on your move").
- **Email:** "X challenged you on [pack] — beat their score" via existing `src/lib/email/senders.ts`, gated on `profiles.notifications_opt_in`. ⚠️ **Risk:** transactional email is already over quota (per ops notes); treat email as best-effort/secondary — **in-app is the reliable Phase 1 channel.**

**Native (rides the single TestFlight rebuild — see §8):**
- **Push:** "your turn", "Marcus beat your score", "challenge expires tonight". Device tokens are blocked until the rebuild ships; the inbox + badges carry the loop until then.

---

## 7. Cleaner MP home — what changes vs today

| Today (`/play` multiplayer) | Phase 1 |
|---|---|
| Open-lobby list (often stale) + Join-by-code + 3-step create wizard, all competing | "Your Turns" inbox (turns / waiting / results) + one "New challenge" CTA |
| Live sync is the only model, front-and-centre | Async challenges are the default; "Play live" is a clean secondary action |
| No sense of pending state or history | Clear pending/waiting/done states + rematch |

The live lobby code (`play/[roomId]`, `/api/room/*`) is **unchanged** — only its entry point moves behind "Play live."

---

## 8. Native layer

**Web-deployable now (works in the iOS WKWebView, ships with the normal deploy):**
- **Native share sheet** via `navigator.share({ text, url })` for challenge links — WKWebView supports the Web Share API. No plugin, no rebuild.

**Bundle into ONE TestFlight rebuild** (the founder needs a rebuild for push regardless — bundle these so it's a single native release):
- **Push notifications** — finish the existing token wiring (the known blocker); power the §6 push messages.
- **Haptics** (`@capacitor/haptics`) — light tap on answer select, success/warning on correct/wrong, heavy on win. (WKWebView has no Vibration API, so this needs the plugin.)
- **Universal Links** (`apple-app-site-association` + entitlements) — a `/h2h/[id]` or challenge link opens the **app** straight into the game, not Safari. Needed for the viral loop to feel native.
- **App-icon badge** — pending-turns count (via push payload / local badge).

Capacitor **Contacts** (fix the broken iOS invite — currently uses the unsupported `navigator.contacts`), **Live Activities / Dynamic Island**, and group/daily features are **Phase 2/3**, not Phase 1.

---

## 9. Error handling & edge cases

- **Expired (7d):** cron flips to `expired`; opening shows "this challenge expired" + Rematch.
- **Targeted vs open:** targeted (`invited_user_id` set) → only that user can accept (`/api/h2h/play` guard); open (null) → anyone with the link, first to play becomes opponent (existing race guard).
- **Challenge yourself / duplicate to same friend on same pack:** block at create (friendly message).
- **Invited friend signed out:** land on `sign_in_needed`, preserve challenge id through auth, return to the game.
- **Opponent already played:** existing `.is("opponent_score", null)` conditional update.
- **Friend deleted account:** `on delete set null` for `invited_user_id` → challenge degrades to open-link.

---

## 10. Out of scope (later phases)

- **Phase 2:** group / N-participant challenges + daily-vs-friends auto-board (introduces `challenge_participants`; inbox unions 1v1 + group).
- **Phase 3:** Live Activities / Dynamic Island (live H2H score on the lock screen), Capacitor Contacts (fix the iOS invite), app-icon badge via push payload, notification cadence/segmentation tuning. (Basic push *delivery* is part of the Phase 1 rebuild in §8 — Phase 3 is the premium native polish on top.)
- Username/handles, public profiles, rematch streak records.

---

## 11. Verification approach

- `next build` green (ESLint gate — run a real build, not just tsc).
- Migration applied + verified on prod via Management API (additive columns + indexes; safe).
- The loop driven end-to-end with two test accounts (or a mock harness for the inbox states), since it's auth-gated and inherently two-player — same constraint as h2h today; note any path not runtime-driven.
- Inbox renders all states (your turn / waiting / results / empty) via a mock-data preview route (deleted before commit), per the established pattern.

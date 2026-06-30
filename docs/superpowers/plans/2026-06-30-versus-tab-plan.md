# Versus tab — implementation plan

Spec: `docs/superpowers/specs/2026-06-30-versus-tab-design.md`

## Refinement from code exploration

- **38-0 already has online play** (live queue: `status: "matched" | "waiting"`
  in `/38-0/live` + `/38-0/wc/h2h`). Reuse confirmed.
- **38-0 has no async invite** (matches are live/synchronous). So the **Your
  Turns inbox is quiz-async only in v1** (existing `useYourTurns` = 1v1 +
  group). 38-0 appears in the *game picker* (launches into live/queue), not the
  inbox. The registry's `renderInboxRow` leaves the seam for 38-0 async later.
- `/leagues` (695 lines, own internal tabs) and `/friends` (477 lines) are big.
  Extract their inner content into panel components rather than inlining raw.

## Build order

### Step 1 — Versus registry (`src/lib/versus/registry.ts`)
Thin config. `VersusGame { id, label, icon, accent, opponentModes, startHref }`.
`VERSUS_GAMES = [quiz, 38-0]`.
- quiz: opponentModes `["friend","group","open","link"]`; startHref routes to the
  quiz versus flow (the `/play?challenge=` / `/play?group` / public-lobby paths
  that already exist, or a small chooser sheet).
- 38-0: opponentModes `["friend","open"]`; startHref → `/38-0/live` (queue) and
  the friend/live path.
No `renderInboxRow` wired to 38-0 in v1 (quiz inbox stays in its own hook); keep
the field optional so it's the documented seam.

### Step 2 — Friends + Leagues panels (extract, don't duplicate)
- `src/components/friends/FriendsPanel.tsx` — move the inner content of
  `/friends/page.tsx` into a panel; `/friends/page.tsx` becomes a thin wrapper
  rendering `<FriendsPanel/>` (keeps the route alive as a deep-link target).
- `src/components/leagues/LeaguesPanel.tsx` — same for `/leagues/page.tsx`.
- This keeps one source of truth; Versus and the legacy routes render the same
  panel.

### Step 3 — Versus page (`src/app/versus/page.tsx`)
- Segmented sub-nav: **Play / Friends / Groups / Leagues** (URL-synced via
  `?view=`, default `play`, mirroring how `/play` and `/leagues` persist tabs).
- **Play**: `<YourTurns/>` (reuse the inbox UI already built in `/play` — extract
  the inbox section + `InboxRow` into a shared `YourTurnsInbox` component so both
  `/play` shortcut and Versus use it) + **Start a versus** game picker mapping
  over `VERSUS_GAMES`.
- **Friends**: `<FriendsPanel/>`.
- **Groups**: list the user's `group_challenges` + a "start a group" entry.
- **Leagues**: `<LeaguesPanel/>`.

### Step 4 — Game picker → opponent step
Tapping a game card opens an opponent sheet from `opponentModes`:
- quiz: friend (→ friend picker → `/play?challenge=<id>` style), group (→ group
  create), open (→ public lobby browse/host), link.
- 38-0: friend (→ live match vs friend), open (→ `/38-0/live` queue).
Reuse existing flows; this is routing, not new gameplay.

### Step 5 — Bottom nav swap + badge move
- `BottomNav.tsx`: replace the Leagues tab (`/leagues`) with Versus (`/versus`),
  `ti-swords` icon, active on `/versus*`.
- Move the `usePendingTurns` badge from the Quiz tab to the Versus tab.
- Quiz tab keeps its icon/route; loses the badge.

### Step 6 — Quiz tab shortcut (two doors, one engine)
- In `/play`, keep a compact "Challenge a friend" entry that deep-links into the
  Versus quiz flow (e.g. `/versus?game=quiz`). The multiplayer sub-tab content is
  now owned by Versus; `/play` is solo-first + the shortcut. Post-result
  `ChallengeAFriendButton` / `GroupChallengeButton` stay.

### Step 7 — Redirects + cleanup
- `/leagues` route: keep rendering `<LeaguesPanel/>` (no redirect needed — it's a
  valid deep target) OR redirect to `/versus?view=leagues`. Decide: **keep the
  route** (thin wrapper) to avoid breaking any shared league links; the tab just
  points at `/versus`.
- Verify `usePendingTurns` count is correct on the new tab.

## Verification

- `npx tsc --noEmit` clean after each step.
- Full `next build` (exit 0) — catches ESLint unused-vars.
- Preview server: load `/versus`, screenshot each sub-view (Play / Friends /
  Groups / Leagues), confirm the game picker opens opponent options, confirm the
  badge renders on the Versus tab.
- Confirm `/play` still works solo + the shortcut deep-links into Versus.

## Out of scope (v1)
Matchmaking *additions* (reuse only), new modes, 38-0 async inbox, group-play push.

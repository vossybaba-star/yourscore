# YourScore — Structure, Automations & Docs Audit — 2026-07-06

Scope: code **structure/maintainability** (not security/perf — audited separately), the
**operational automations** running the business, and **doc freshness / how agents stay
current**. Traffic spike expected within ~2 days, so every item is tagged **SAFE NOW** or
**AFTER SPIKE**.

## Executive summary
The codebase is well-organized at the folder level (`lib/draft` is cleanly partitioned, real
test coverage exists for game logic) but has a handful of **god files** (game-loop pages of
870–1,330 lines) and **duplication that causes drift** (8+ avatar clones, repeated timer/fetch
patterns). Type safety is loose in places (50 `as any`, 178 eslint-disables) and there are
**zero per-route error boundaries** — one page error can white-screen the app. Operationally,
the business runs on **15 local launchd jobs + 5 Claude-desktop tasks with no redundancy**
("laptop off = business dies" is still true), several **dead jobs still waking on a timer**,
and **no failure alerting**. The **docs were the real cause of "agents are out of date"** —
fixed this session (see §3). Nothing here required a risky change before the spike.

---

## 1. Code structure

### God files (client components, game logic tangled with UI)
| File | Lines | Hooks | Tangled | Decompose to |
|---|---|---|---|---|
| `src/types/database.ts` | 2,571 | — | generated schema dump | split by domain (optional) |
| `src/app/challenges/[slug]/page.tsx` | 1,328 | 35 | game loop + timer + scoring + UI + fetch + analytics | `lib/challenges/gameEngine.ts` + a timer hook |
| `src/app/play/[roomId]/page.tsx` | 1,135 | 57 | realtime lobby + channel mgmt + polling + answer broadcast | `hooks/useRoomRealtime.ts` |
| `src/app/38-0/wc/run/[id]/page.tsx` | 977 | 46 | tournament phases + pens + upgrades + quiz branching | phase reducer/state machine |
| `src/app/38-0/live/match/[id]/page.tsx` | 871 | 28 | live H2H phase machine + bot + swap windows | phase reducer/state machine |

All five are `"use client"` with game logic inline rather than in `lib/`. The phase-transition
bugs risk (swap windows, realtime cleanup) lives here.

### Duplication (drift risk)
- **Avatar component defined 8+ times** — canonical `components/ui/PlayerAvatar.tsx` exists but
  `play/[roomId]`, `challenges/[slug]`, `h2h/[id]`, `league/[id]`, `versus`, `components/game/Leaderboard.tsx`
  all inline clones. Palette logic duplicated 3×. Design changes need 8 edits.
- **`timerDisplay(ms)`** copy-pasted (`challenges/[slug]`, `h2h/[id]`) → move to `lib/format`.
- **`setInterval` clock boilerplate** in ~18 pages → a `useCountdown`/`useInterval` hook. A
  `lib/useGameLoop.ts` exists but is unused in most places.
- **`fetch`+try/catch** repeated in 30+ routes/pages with no shared error bubbling → a typed
  `lib/http.ts` wrapper.

### Type safety
- `as any`: **50** · `: any`: **33** · `eslint-disable`: **178** · `@ts-expect-error`: 0.
- Clusters: `app/page.tsx` (17), `profile/page.tsx` (16), `api/draft/history` (10),
  `components/friends/FriendsPanel` (9), `api/draft/wc/draft` (9). Root cause: RPCs/tables not in
  the generated types (`draft_credit_result`, `get_yourscore_rank`, etc.). Fix by regenerating
  Supabase types (incl. RPCs) or a typed wrapper.

### Resilience & testing
- **Error boundaries: only `app/global-error.tsx`. Zero per-route `error.tsx`.** One fatal error
  anywhere → whole app crashes. Highest-value/lowest-risk structural fix.
- **Tests:** solid coverage of deterministic game logic (`lib/draft/*.test.ts`, run via
  `node:test`) — but **nothing** for components, API routes, realtime, or user flows; no
  jest/vitest config; Playwright is in devDeps but no e2e set up.

### Dead / stale
- `src/graphify-out/` (~960KB) looks like a **stale duplicate** of the active root
  `graphify-out/` — verify then delete the `src/` copy (memory already flags this). *(Do not
  touch the root `graphify-out/` — it's the live knowledge graph.)*
- Note: an earlier finding that `src/data/draft/player-seasons.json` is "empty" is **incorrect**
  — it's the 2.6MB player dataset (now dynamically imported). Leave it.

---

## 2. Operational automations

**15 launchd jobs + 5 Claude-desktop tasks; no cron; no hardcoded secrets** (all use
`--env-file=.env.local`). Core money-makers healthy: `quiz-launch` (daily 09:30), `wc-roll`
(08:00), `health` (4×/day), `ig-poll`/`ig-send` (@433-style repurpose), the daily WC-quiz Claude
task, security-audit task, ads-summary task.

**Issues / waste:**
- **Dead jobs still scheduled:** `x-drip` (last real run Jun 15), `x-propose` (Jun 18),
  `reddit-track` + `reddit-poll` (self-gated OFF since the Jul-5 manual pivot). `reddit-poll`
  and `x-propose` **wake on a timer forever just to no-op** → unload the plists (keep the code).
- **No log rotation** — `x-telegram.log` already 867KB; every job appends unbounded.
- **Doc drift, operationally dangerous:** `quiz-launch` plist fires **09:30**, but the script
  header + retired SKILL say **07:06** — a "correction" could break the draft→launch ordering.
  Fix the stale comments.
- **No failure alerting** — only `health` self-reports; a silent missed `quiz-launch`/`wc-roll`
  goes unnoticed. Add a deadman check (health already has `deadman.config.json`).
- **72 X drafts** backed up (queued faster than reviewed) — raise review cadence or auto-expire.
- **Every-2-min pollers** (content, ig, + the 60s x-telegram) = constant wakeups; widen to 5 min
  once Reddit is unloaded.

**Single point of failure (highest-leverage infra fix):** all 15 launchd jobs are **local**, and
the 5 Claude tasks need **Claude Desktop running**. Laptop asleep/off ⇒ no quiz launch, WC
editions stop rolling, monitoring dark, all social/ads/email halt — **no redundancy**. Most
jobs are pure-node + `--env-file` and **Linux-portable today**. Recommended: move the pure-node
jobs (quiz-launch, wc-roll, health, ig-send, x-*) to a small always-on **VPS** first (kills the
worst failure), then port the Claude-app tasks (as headless `claude`/API cron) and browser flows.

---

## 3. Docs & "why agents are out of date" — FIXED this session

**Root cause was not a stale source-of-truth doc.** `YOURSCORE.md` is well-maintained
(85–90% current, disciplined `YOURSCORE.md: X confirmed` commits). The problems were:
1. The short, always-auto-loaded **`CLAUDE.md` duplicated a feature list that had drifted** — it
   literally said *"Not built yet: Friends, public profiles"* while both shipped weeks ago.
   Agents trust the short file, so they inherited stale facts.
2. **No enforcement** — nothing made a fresh session load the current state.
3. The 565-line doc had **no fast "what's new" index**.

**Applied fixes (all safe, docs only):**
- **Rewrote `CLAUDE.md`**: removed the drifting feature-list duplication (kept only genuinely
  stable facts); added a "how to work in this repo" operating-principles section + a gotchas
  section; hard directive to read YOURSCORE.md's changelog and never claim a feature is unbuilt
  without checking.
- **`YOURSCORE.md`**: added a top-of-file **"§0 Recently Shipped (last ~30 days)"** scan-list +
  the missing **`Username`** glossary term.
- **`.claude/settings.json` `SessionStart` hook**: auto-injects the changelog + last 10 commits
  into every session so agents start current without being told (verified output).

*(Remaining YOURSCORE.md nice-to-haves, low priority: expand §7 push/email-engagement prose;
these are now covered by the §0 changelog pointers.)*

---

## Prioritized actions

### SAFE to do before the traffic spike (do these)
1. **Add `error.tsx` boundaries** to `challenges/`, `play/`, `38-0/live/`, `38-0/wc/`, `versus/`,
   `match/[id]/` — stops one error white-screening the app. *(Low effort, pure resilience.)*
2. **Unload the 4 dead launchd jobs** (`x-drip`, `x-propose`, `reddit-track`, `reddit-poll`) +
   add log rotation. *(Removes wakeups/waste; keep the code.)*
3. **Fix the `quiz-launch` 07:06-vs-09:30 comment drift** so nobody breaks the sequence.
4. **Remove the stale `src/graphify-out/` duplicate** (verify first; never touch root `graphify-out/`).
5. **Consolidate the 8 Avatar clones** onto `PlayerAvatar` + extract `timerDisplay`/countdown to
   `lib`/hooks. *(Pure refactor, no behavior change — but land + `next build` before the spike.)*
6. **Add a deadman alert** on `quiz-launch`/`wc-roll`/`ig-send`.

### AFTER the spike (risky — touch core game loop / most of the app)
7. Extract game logic from the god pages into `lib/{challenges,quiz,room}` (phased, one game at a time).
8. Move game phases to reducers/state machines (challenges, wc/run, live/match).
9. Consolidate realtime into `hooks/useRoomRealtime.ts`; make the Supabase client a lifecycle-managed singleton.
10. Regenerate Supabase types (incl. RPCs) and drive `as any` toward zero.
11. **VPS migration** — the highest-leverage infra fix; removes the single point of failure.

*Docs/process fixes in §3 already applied. No code changed in this audit beyond docs + the
SessionStart hook.*

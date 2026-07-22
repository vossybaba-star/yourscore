# YourScore — Full Product Audit (outside-in)

**Date:** 2026-07-11 · **Scope:** entire user experience + optimisation surface, audited agency-style across six dimensions: acquisition & first touch, Quiz loop UX, 38-0 loop UX, performance, retention & lifecycle, technical health & instrumentation.

**Method:** six independent audit passes over the code at HEAD (which deploys to prod from `main`), each verifying claims against actual components, routes, and libs — every finding carries `file:line` evidence. Limitations: this environment has no `.env.local`, so Sentry issues and live DB advisors were not pulled; outbound fetches to yourscore.app were blocked by the sandbox proxy, so live-payload checks are inferred from code rather than measured. Deliberate product choices (guest-first anonymous play, disguised-bot fallback with honest reveal, per-play seed salting, `rooms`→Lobby naming freeze, `ignoreBuildErrors`) were treated as accepted context, not findings.

---

## Executive summary

The product's happy paths are genuinely strong — the WC Mastermind daily loop, the shadow-match revenge system, the post-game scorecard, and the home dashboard are polished, well-engineered surfaces. But six cross-cutting problems undermine growth, and three of them are time-critical:

1. **The July 19 cliff (8 days away).** Nearly the whole daily-habit machine is hardcoded to the World Cup: the 38-0 default tab, the app's *only* scheduled daily push, the Quiz leaderboards tab, both official Discover cards, and all £25/£100 prize copy. There is no season-end mechanic, no champion-crowning moment, and the WC board window simply freezes at Jul 19 while runs keep counting toward nothing. Simultaneously, the **logged-out landing page still says "Create your league before Jun 11"** — a month expired, mid-tournament, on every paid-ad landing.

2. **Broken promises at the hottest conversion moments.** "SIGN UP & SAVE SCORE" does not save the score. "SAVE YOUR TEAM" dumps the converted user on the generic dashboard. The post-win "SWAP ONE PLAYER →" CTA — the core 38-0 win reward — is dead code that silently bounces every user. These are the three highest-intent taps in the product and all three break their promise.

3. **Live multiplayer is fragile off the happy path.** A quiz game stalls forever if the host backgrounds their phone (client-side timer, no server watchdog); refresh/reconnect never restores the live question; guests opening game links get an infinite spinner; answer failures are silent; spectators corrupt the answered-counter.

4. **Trust & integrity gaps.** Correct answers ship to the browser on a public cached endpoint while the £100 prize board rides on those scores (timing is client-supplied too — a perfect max-speed score is a ~10-line script). Fabricated "managers online" / "looking for match" numbers sit adjacent to a "verified ✓" leaderboard brand. Five ad pixels fire with no consent layer for a UK/EU audience.

5. **Flying blind.** PostHog — the one tool built to answer "where do users drop off" — is fully implemented and mounted **nowhere**. GA4 sees one pageview per SPA session. The funnel is currently unanswerable.

6. **The founder's-laptop dependency + speed tax.** The daily quiz pipeline, lapsed-player winback, and send-time personalization all run from LaunchAgents on a Mac; the realtime kill-switch needs a redeploy to pull. Meanwhile the founder's own nav-slowness complaint traces to a measurable client-side tax: 22 `auth.getUser()` network call sites, a 5-deep waterfall on /versus, a GoTrue roundtrip in middleware on every request, and 6.6MB of raw badge PNGs.

---

## The ten fixes I'd make first

| # | Fix | Why | Effort |
|---|-----|-----|--------|
| 1 | **Jul 19/20 cutover plan**: crown the WC champion (email template 10 exists, unwired), flip 38-0 default tab, swap Versus hero + Discover cards, move the daily push off the wc2026 series, sweep prize copy behind a flag | The entire daily-habit machine dies or lies in 8 days | 2–3 days, deadline-bound |
| 2 | **Rewrite the logged-out landing** — kill "before Jun 11", sell what's live (38-0 draft, quiz catalogue, daily debate), one primary CTA | Every ad click lands on a page that looks abandoned | 1 day |
| 3 | **Make "Sign up & save score" true** — stash the run in localStorage across OAuth, submit on return (WC hub already has the pattern) | Highest-intent conversion moment, currently a false promise | half day |
| 4 | **Fix or remove the dead win-swap loop** (`swapAvailable` never set true) + fix loss framing ("REBUILD" for a retired stale-team model) | The flagship game's core reward doesn't fire | half day |
| 5 | **Server watchdog for quiz rooms** — any member (or cron) can advance past `closes_at` | One backgrounded host phone freezes every player forever | 1 day |
| 6 | **Strip answers from competitive pack payloads + server-issued timing** | £100 prize board is forgeable from DevTools | 1–2 days |
| 7 | **Mount PostHog** (EU host) + route-change pageviews | Can't grow what you can't measure | half day |
| 8 | **Kill the client auth tax**: `getSession()` over `getUser()`, one `/api/versus/hub` endpoint, unblock the pack fetch, persist BottomNav in a layout | Directly attacks the founder's ~1s nav complaint | 2–3 days |
| 9 | **Streak integrity + defense**: count WC runs/debate votes toward the streak, fix the limit(12)/45-day caps, add an evening streak-saver push | The pushed daily habit doesn't feed the streak it builds | 1 day |
| 10 | **Consent gate for ad pixels** (Consent Mode v2 or minimal region-aware CMP) | UK/EU legal exposure + App Store risk | 1–2 days |

---

## Theme 1 — The July 19 cliff (P0, time-boxed)

Everything below detonates on or around Jul 19–20:

- **Every default surface points at the tournament.** 38-0 lands on the WC tab (`src/app/38-0/page.tsx:45`); the Versus hero sells "top the board, win £100" (`src/lib/versus/registry.ts:48`); the Quiz tab's Leaderboards view is *only* the wc2026 daily board (`src/app/play/page.tsx:487-561`); both official Leagues-Discover cards are WC boards (`src/app/api/leagues/discover/route.ts:51-57`).
- **The board window freezes; play keeps counting toward nothing.** `WC_SEASON_END = "2026-07-19"` (`src/lib/draft/wc.ts:27-28`, duplicated in `wc-og/route.tsx:23-24`, `wc-server.ts:498`) ends the board query, but ranked runs aren't gated — from Jul 20 "Today's Run" still plays but feeds no visible board. No crowning moment, no countdown, no wrap exists in code despite `wc.ts:26` promising "a champion is crowned".
- **The app's only scheduled daily push dies silently or lies.** The hourly `wc-mastermind` cron (`vercel.json:8`) no-ops with `"no-pack-today"` and **no alerting** when no wc2026 daily pack exists (`src/app/api/cron/wc-mastermind/route.ts:59-72`); its copy is hardcoded "World Cup Mastermind Daily is live 🧠" (`:103`). The pack supply itself is WC-match-recap quizzes generated and published by **LaunchAgents on the founder's Mac** (`scripts/launch-daily.sh:4-11`) — after Jul 19 the recap premise has no matches.
- **The debate schedule runs dry Aug 5.** `scripts/seed-debates.mjs` ends 2026-08-05; runtime falls back to "most recent past debate" forever (`src/lib/debate.ts:32-41`) — the card fossilizes on one debate with no low-runway alert. (The Jul 20–Aug 5 entries are already evergreen — the content survives the WC; the pipeline doesn't.)
- **The logged-out landing is a month stale.** "Create your league before Jun 11 →" (`src/components/home/MarketingLanding.tsx:735`), "START YOUR LEAGUE — World Cup 2026 · June 11" (`:758-759`), a hero depicting live-match watching — a feature that is explicitly not live — and "THE CUP IS LIVE" rendering forever once the date passes (`:71`).

**Recommendation:** treat Jul 19 as a launch in reverse. Ship a Season-1-finale → Season-2 arc: crown the WC champion loudly, introduce a season-scoped YourScore Rank board (the all-time ladder is already uncatchable for newcomers — YOURSCORE.md §6 self-diagnoses this), re-point every default surface, and replace the hardcoded window with a seasons table.

---

## Theme 2 — Broken promises at conversion moments

1. **"SIGN UP & SAVE SCORE" discards the score.** The guest post-quiz CTA links to sign-in (`src/app/challenges/[slug]/page.tsx:1242-1244`), but the run lives only in React state; the converted user lands back on the pack *intro*, score gone, and the intro warns "your first score counts on the leaderboard" (`:891`). Fix: stash the answer log across the redirect and submit via `/api/quiz/solo-complete` on return — mirror `/38-0/wc/page.tsx:358-377`, which already does this perfectly.
2. **"SAVE YOUR TEAM" strands the convert.** The post-draft sign-up prompt links to bare `/auth/sign-in` with no `?next=` (`src/app/38-0/page.tsx:195-198`) → lands on the generic dashboard. One-line fix.
3. **The win reward is dead code.** `swapAvailable` is never set `true` anywhere — `recordWin()` no longer grants it (`src/lib/draft/local.ts:69-71`), yet the post-win primary CTA is "SWAP ONE PLAYER →" (`src/app/38-0/match/result/page.tsx:134-137`) and the swap page silently bounces (`swap/page.tsx:37`). The advertised win→swap loop cannot fire.
4. **Loss messaging sells a retired model.** Stale-team was retired (`local.ts:230-231`) but the loss CTA is a red "REBUILD XI →" and share copy says "Rebuilding…" (`result/page.tsx:45,142-145`) — players are told to scrap a playable XI.
5. **Challenge links wall the recipient.** `/h2h/[id]` and `/g/[id]` demand an account before any play (`h2h/[id]/page.tsx:64,245,683`; `g/[id]/page.tsx:105`) — while the same quizzes are guest-playable at `/challenges/[slug]`, and the debate flow proved the vote-first/gate-later model. The h2h accept page also offers **Google-only** sign-in (`h2h/[id]/page.tsx:773`) — no Apple path for iPhone users at the hottest referral moment. A 38-0 challenge invitee with no XI is silently bounced to the hub, losing the challenge context (`challenge/[code]/page.tsx:50-51`).
6. **The sign-in page wastes the moment.** One generic screen for every entry (`auth/sign-in/page.tsx:52-54`); `next` is already parsed — render "Save your XI · 84 STR" / "Put your 2,340 pts on the board".
7. **Share unfurls are generic on the highest-volume share URL.** `/h2h/[id]` has no metadata/OG (pure client page), so "beat my score" messages unfurl as the stock home card — in contrast to the excellent personalised cards on /debate, /s/[id], and WC share.

---

## Theme 3 — Live multiplayer fragility (Quiz)

The happy path is polished; nearly every deviation dead-ends the game:

1. **P0 — host backgrounds phone → room stalls forever.** Question advance is a client `setTimeout` on the host device only (`/play/[roomId]/page.tsx:358-371,520-524`); `/api/room/next` rejects non-hosts (`api/room/next/route.ts:34`); no server fallback. Mobile backgrounding suspends JS timers.
2. Refresh/rejoin never restores the in-flight question (`:420-434`); a host refresh means no advance is ever scheduled again.
3. No connection-loss handling: `.subscribe()` with no status callback (`:500`), no resubscribe, no reconnecting UI, zero `visibilitychange` handlers in any quiz flow.
4. Signed-out users opening a game link spin forever (`:391` vs `:673`).
5. Answer failures are silent — `QuestionCard` catch swallows "Question closed" / 429 / network errors (`QuestionCard.tsx:53-55`).
6. Any visitor to a live/finished room is silently enrolled as a player (`:431`), corrupting the answered-counter and killing early-advance.
7. Instant matchmaking ends in a manual lobby: matched humans wait on a stranger host with no timeout; matched CPU games still require the user to press Start (`quiz-matchmaking.ts:103-152`).
8. Quitting is unhandled: the documented −100 ragequit penalty (`scoring.ts:216`) has zero call sites; abandoned opponents get no "opponent left" signal.
9. Timers charge you while backgrounded (`lib/useGameLoop.ts:34-41`) — a notification glance drops Lightning → Very Slow.

---

## Theme 4 — Trust & integrity

1. **The prize board is forgeable.** `/api/challenges/pack` returns questions **with answers** on a public, unauthenticated, edge-cached route (`api/challenges/pack/route.ts:19-26`); grading is client-side during play; `/api/quiz/solo-complete` re-grades from client-supplied letters + `elapsedMs` clamped only to [0, 30s] (`solo-complete/route.ts:117`; same `h2h/play:110`). Club-league events already do this right (answers never leave the server) — apply the same standard to anything leaderboard- or prize-bearing.
2. **Fabricated liveness numbers.** A seeded 24–68 "looking for match" floor (`lib/versus/activity.ts:113`) and a random 70–220 "managers online" jitter in matchmaking (`38-0/live/page.tsx:373-377`) — flagged `TODO(real-presence)` in four places. Adjacent to a "verified ✓" board brand and real cash prizes, this is reputational risk. Time-box it or soften to non-numeric copy.
3. **No consent layer.** GA4, TikTok, X, Meta, Snap all fire on load (`layout.tsx:116-202`); no CMP anywhere; Sentry has `sendDefaultPii: true` (`sentry.server.config.ts:19`). EU-hosted data infra shows the team knows the jurisdiction — the front end doesn't match.
4. **/messages is a half-live feature, not a stub.** Full realtime chat reachable from FriendsPanel, writing via the anon client with `as any` casts, client-set `sender_id`, and no send error handling (`messages/[userId]/page.tsx:57-130`). Either an RLS hole or silently broken UX — verify RLS or remove the entry point.
5. **The realtime kill-switch is disarmed.** `REALTIME_ENABLED = true` hard-coded (`src/lib/realtime.ts:11`) — the documented WC-surge load-shedding lever now requires a redeploy under load. Env-var it.
6. **Un-rate-limited email validation endpoint.** `/api/auth/validate-email` does live DNS lookups with no rate limit (`route.ts:15`) — every comparable route uses `rateLimitDistributed`, even unauthed ones.
7. Scoring-explainer copy is wrong everywhere it appears: landing promises "+200 pts / ×2" (`MarketingLanding.tsx:649-652`), intro tiles promise "Instant 1,000" (`challenges/[slug]/page.tsx:868-879`), the h2h bar divides by `total_questions × 1000` (`h2h/[id]/page.tsx:684`) — actual engine max is 200–600/question. Three different fictional systems before the first game.

---

## Theme 5 — Flying blind (analytics)

- **PostHog is dead code.** `PostHogProvider.tsx` (pageviews, identify, EU masking, recordings — all built) is imported by nothing; `posthog-js` ships in the bundle deps for nothing. GA4 gets one pageview per SPA session (no route-change `page_view`, `layout.tsx:117-133`). The founder cannot currently answer "where do users drop off between landing → first game → signup → D1." Mount the provider (EU host — the config defaults to US, `lib/posthog/client.ts:17`), mirror the existing `trackGamePlay/Complete`/signup/share events into `posthog.capture`.
- The gtag stub is defined twice (`layout.tsx:111-115,126-127`); six trackers load `afterInteractive` and compete with app chunks on throttled phones — move pixels to `lazyOnload`/first-interaction.

---

## Theme 6 — Speed (the founder's nav complaint, explained)

Ordered by expected user-facing impact:

1. **The client auth tax.** 22 client-side `auth.getUser()` call sites — each a GoTrue network roundtrip on mount. `BottomNav` remounts on **every** route (it's rendered per-page, not in the layout) and fires ~4 network calls per navigation (`BottomNav.tsx:27-29` → useUser/usePendingFriends/usePendingTurns). Fix: `getSession()` (localStorage, 0ms) everywhere except security-sensitive writes; persist BottomNav in a route-group layout; one badge endpoint.
2. **/versus is a 5-deep sequential waterfall** (~2–5s to full content): `useYourTurns` alone is five sequential waves (`hooks/useYourTurns.ts:47-113`), `useVersusStats` adds three more, plus four more fetching components — ~15+ browser requests, 4–5 serial Frankfurt roundtrips. Fix: one server-side `/api/versus/hub`.
3. **Picker→quiz serializes auth before the (already edge-cached) pack fetch** (`challenges/[slug]/page.tsx:481-540`): 4 sequential roundtrips signed-in — this *is* the measured ~1s. Fix: fire the pack fetch immediately, parallelize attempt + leaderboard.
4. **Middleware calls GoTrue on every request** for signed-in users (`lib/supabase/middleware.ts:66-73`) — serial ~100–300ms on every nav, RSC request, and API fetch. Fix: local JWT decode, refresh only near expiry.
5. **6.6MB of badge PNGs** (98 files, up to 243KB each) rendered at 36–84px through 90 raw `<img>` sites — `coverUrl()` only transforms Supabase URLs. Fix: one-off 128px WebP resize (~5–10KB each).
6. **/play multiplayer tab: N+1 member-count queries** from the browser — up to 21 requests (`play/page.tsx:515-527`). Fix: one edge-cached rooms+counts route.
7. **/38-0 hub downloads the 2.6MB player pool for a cosmetic count line** (`38-0/page.tsx:46-48`, `pool.ts:78`).
8. **1MB penalty backdrop PNG** (`public/sprites/pens/bg.png`) pops in mid-game — WebP it (~150KB) and preload.
9. **Missing cache guards**: ~9 service-role GET routes lack `fetchCache="force-no-store"` (quiz/availability, draft/records, versus/shadow, club/*, friends, draft/challenge/[code], admin/club-leagues) — the exact stale-pin trap documented in CLAUDE.md §4; and leaderboard/yourscore, leaderboard/wc2026, leagues/discover, versus/activity set only the CDN `s-maxage` header, which does not cover Vercel's durable Data Cache.
10. 63 of 83 pages are `"use client"`; only 2 `loading.tsx` files exist. `/leaderboard` (identical data for everyone) is the highest-leverage server-component conversion.
11. Dead weight: `public/models/*.glb` (3.4MB, zero references — pens is 2D now), 14MB of `public/email` in every deploy, all grid cover images `eager`+`fetchPriority=high`.

---

## Theme 7 — Retention machinery gaps

1. **The pushed daily habit doesn't feed the streak.** Home streak/week-dots derive only from `quiz_attempts` + `draft_matches` (`src/app/page.tsx:102-133`); WC Mastermind runs write neither, so a faithful daily-push player sees "START A STREAK". Also: 38-0 contribution capped at the last 12 matches with no date floor (`:108`), quiz window 45 days — silent streak corruption. Two-line query fix.
2. **No streak defense.** Computed read-time on Home only, never stored — no at-risk push, no repair token, no milestones. The `notifyUsers` + `active_hour_utc` plumbing sits idle 23 hours a day.
3. **One "Maybe later" kills all push asks forever.** `PushPrePrompt.later()` writes the same key `NotifyOptInCard` bails on (`PushPrePrompt.tsx:67-70`, `NotifyOptInCard.tsx:38`) — the code's own "backup" comment is false, and this exact bug already forced a v1→v2 key bump. Also the pre-prompt fires at first sign-in, before any earned value.
4. **Push reaches only native users.** No web-push path exists (`notify.ts:9-11`) while the web is the primary live surface — the single highest-leverage retention build for the post-WC period.
5. **Winback is laptop-ops.** The only automated lifecycle email targets signed-up-but-never-played users, once ever, 50/run (`api/cron/comeback/route.ts:9-25`). Lapsed *players* are handled by `scripts/reengage.mjs` run manually from the founder's Mac. Templates 05/07/08 (pre-match, weekly digest, top-of-league) exist and are unwired. Port the cohort logic to a Vercel cron; ship the weekly digest.
6. **Leagues never push.** Position changes are computed client-side from localStorage on visit (`league/[id]/page.tsx:241-251`); no "X passed you" notification exists — the highest-signal social push in the app, unbuilt. Friend requests are email-only (`api/friends/route.ts:90,115`). Comments/debate replies notify nobody (`api/comments/route.ts`).
7. **All-time-only ladder.** A WC-month grinder cohort locks in an uncatchable YourScore Rank for every newcomer; Jul 20 is the free narrative moment for Season 2 + a legacy tab.

---

## Additional UX findings worth batching

**38-0:** unskippable ~95s match playback on solo CPU matches (season sim has Skip; match watch doesn't — `playback.ts:18`); irreversible draft placement with no undo/fit-hints while `bestOpenSlot()` exists but only serves the bot (`opponent.ts:80`); four leaderboards with colliding names and two competing sub-navs (`DraftHeader.tsx:16-21` calls the H2H ladder "Board", the hub uses "Board" for the verified table); "How it works" exists only on the WC tab; the £25 giveaway sheet auto-opens 700ms after every result, covering the reward moment (`season/page.tsx:125-134` — same pattern on quiz results, `challenges/[slug]/page.tsx:622-630`); orphaned `/38-0/match/prematch` route (`saveMatchup` has no callers); vestigial "● AVAILABLE" badge; docs/comments still claim a 3D pens scene — shipped scene is 2D (`PenaltyShootout.tsx:4-18`).

**Quiz:** hidden multiplayer panel inside /play reachable only via `?join=` deep link with broken tab state (`play/page.tsx:541-547,861-970`) — open-lobby browser and turns inbox effectively orphaned; `/play/new` pack picker is a bare alphabetical list of ~110 packs with no search while rich pickers exist elsewhere; lobby Start button doubles as a status label and allows accidental solo starts; timer colors don't match real speed-band edges; stale copy "Go to Play > Head-to-Head" (`play/page.tsx:355`).

**SEO/discoverability:** `/38-0` and `/play` (sitemap priority 0.9) have **no route metadata** — they unfurl and rank on the generic root card; quiz pack pages have good per-slug SEO but are missing from the sitemap; the blog has **zero inbound internal links** (the entire stated reason for blog-on-main-domain — authority consolidation — is currently disconnected); no Organization/WebSite JSON-LD; two competing taglines ("The Home of Football Gaming" vs "Football Knowledge Game").

**Native funnel:** AASA covers only auth + h2h/g — debate shares, /challenges/*, /s/*, WC share, league joins all open Safari for app owners; the custom App-Store banner shows on first touch and every session (per-session dismissal only); `maximumScale:1, userScalable:false` fails WCAG 1.4.4; no offline handling at all for a remote-URL Capacitor webview (`capacitor.config.ts:7`) — connectivity loss = dead app; `global-error.tsx` renders the unbranded Next.js error page (`:23`).

**Docs drift to reconcile in YOURSCORE.md** (per project rule §13): guest Quick Match claim (§5B — guests currently can't reach it, `team/page.tsx:523-531`), win→swap/lose→stale loop description, 3D pens claim, "sub-tabs Solo + Multiplayer" (§9), debate "cycle wraps" rotation description (code is date-row-or-most-recent-past).

---

## What's genuinely good (keep and extend)

- **WC Mastermind daily loop**: server-authoritative grading with zero answer leakage, clean one-run-per-day messaging, catch-up edition strip, coherent share loop — this is the standard the solo/h2h quiz paths should be raised to.
- **Shadow-match revenge system**: rally bypass, 24h aggregation, "beats open the push, holds never do" — the best retention mechanic in the codebase, and fully WC-independent.
- **Server-side integrity where it counts**: cron/webhook auth fails closed, Resend webhook svix-verified, scoring recomputed server-side, admin APIs uniformly guarded.
- **Home dashboard** is the reference pattern: parallel server-component fetches, real stats, correct cache guard.
- **Edge-cache pattern exists and works** (quiz/packs, challenges/pack, leaderboard/yourscore, versus/activity) — the fixes above are about applying it consistently.
- **Error boundaries** (per-segment RouteError), reduced-motion respect, low empty-catch density, AASA/AppsFlyer pre-wiring.

## Suggested 30-day sequence

- **Week 1 (before Jul 19):** items 1–4 of the top-ten table (cutover, landing rewrite, save-score, win-swap) + streak feed fix + debate bank extension + `no-pack-today` alerting.
- **Week 2:** quiz-room server watchdog + reconnect handling; answer-stripping on competitive packs; PostHog mount; consent gate.
- **Week 3:** speed sprint — getSession migration, /versus hub endpoint, middleware JWT check, badge WebP, cache-guard sweep.
- **Week 4:** retention build-out — web push, weekly digest cron, league-movement push, winback cron off the laptop; Season 2 board.

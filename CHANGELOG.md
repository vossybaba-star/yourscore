# YourScore — Changelog

Ship history for YourScore. **Newest first.** The product *definition* lives in
[`YOURSCORE.md`](./YOURSCORE.md) — this file is the diary, that file is the truth.

> Split out of YOURSCORE.md on 2026-07-23, where it had grown to ~890 lines of
> preamble ahead of the actual definition. Nothing was dropped in the move.

---

## Recently shipped (scan-list)

Scan-list so any session gets current in one glance — newest first. Full detail is in the
Confirmed preamble above and the referenced section.

- **2026-07-25** — **"Build a Quiz" is now a Solo sub-tab, not a tile** (`src/app/play/page.tsx`,
  local, uncommitted). Removed the "Build your own quiz" banner tile that sat above the Featured
  grid; added **Build a Quiz** as the 5th Solo sub-tab (after Records). That tab holds the builder
  CTA (→ `/quiz/create`) plus the **Your Quizzes** section — the packs a user has built now live
  under Build a Quiz instead of floating above every Solo view. Empty state added for users with no
  built quizzes. Verified in preview.
- **2026-07-25** — **Quiz intro no longer waits on the leaderboard** (BUILT on
  `fix/quiz-flow-ux`, NOT MERGED). Tapping a daily quiz felt like a 3-4s load on a cold phone.
  Measured the cold tap on the simulator + prod: the game *content* is one fast edge-cached
  call (`/api/challenges/pack`, ~140ms); the wait was a top-100 `quiz_attempts` leaderboard
  read (browser→Supabase Frankfurt, ~1.2s) that `challenges/[slug]/page.tsx`'s mount effect
  **awaited before `setPhase("intro")`** — so the playable screen sat spinning ~1s *after* the
  questions were ready (pack done ~740ms, intro blocked until ~2000ms). Fix: render the intro
  the moment the pack loads and run the prior-attempt + leaderboard reads in the background
  behind the existing `leaderLoading` spinner (`setPhase` now precedes the awaited reads). The
  post-play `saved`→refetch effect still corrects the board if the guest-score claim races it.
  Measured after (local SPA nav): START button playable at **518ms** vs leaderboard done at
  1138ms — **~620ms earlier locally, more on a real phone**. Fires on every quiz load, guest
  and signed-in (signed-in has more of these blocking client reads). Of the 15 client calls on
  that page, only 2 are the game (pack + leaderboard); the other ~10 are ad/analytics/Sentry
  beacons (GA4, DoubleClick, remarketing, PostHog) that don't block render but contend for a
  cold radio — deferring those past first paint is a separate, still-open lever.
- **2026-07-24** — **Service worker caches the build assets** (BUILT on `fix/quiz-flow-ux`,
  NOT MERGED). The app stops re-downloading its own JavaScript on every cold start. Measured
  on prod first: the `/play` route pulled **422 kB across 22 requests** of `/_next/static/`
  on a cold load, against a 43 kB HTML document — so the document was never the expensive
  part, the bundle was. Verified after: **0 bytes over the network** for all 25 static assets
  on a repeat load.
  Deliberately narrow. It caches `/_next/static/**` and nothing else: those filenames are
  content-hashed, so cache-first there can never serve something stale. HTML and RSC payloads
  are **not** cached — a cached document means a cached RSC payload inlined in it (yesterday's
  fixtures rendering as today's), and a document that outlives its chunks is how you get a
  ChunkLoadError with no way back. Everything that is not `/_next/static/` gets no
  `respondWith` at all, so API routes, Supabase, Sentry and the pixels are untouched.
  Two safety properties, both tested: **`SW_DISABLED=1` + redeploy** serves a self-destruct
  worker instead (browsers re-fetch the worker script on navigation, so it reaches clients
  whose page a bad worker has broken — the one exit that does not depend on the app working);
  and the cache name carries the deploy id, so each deploy activates into a fresh cache and
  drops the last one rather than accumulating every build's chunks. The self-destruct
  deliberately does not navigate its clients — a worker that reloads on activation, on a page
  that registers a worker every load, is a reload loop waiting for one browser to disagree
  about when an activating worker claims clients.
  **ANSWERED on the simulator (iPhone 17, iOS 26.5), and the answer is a product decision.**
  The worker does **nothing** in the iOS app as currently configured, and it is not a
  registration failure — `navigator.serviceWorker` is **not present at all** in the webview
  (`swInNavigator: false`, with `secureContext: true`, so it is not a TLS problem). Add
  `WKAppBoundDomains` to `ios/App/App/Info.plist` plus
  `ios.limitsNavigationsToAppBoundDomains: true` in `capacitor.config.ts` and it works end to
  end: API present, `register: OK`, 1 registration, controller YES, and on the second launch
  the cache holds **26 entries**. So App-Bound Domains is exactly the switch, and it is proven,
  **but it has not been shipped** — turning it on restricts the webview to navigating only the
  listed domains (max 10) and restricts native JS injection off them. Capacitor's own bridge
  was fine in the test; sign-in, the pixels and any third-party navigation were NOT
  regression-tested under it. Founder call before enabling.
  Testing notes for whoever repeats this: the app's CSP carries `upgrade-insecure-requests`,
  so a webview pointed at `http://localhost` loads the document and then fails every
  subresource — it needs real TLS (a local CA trusted via `xcrun simctl keychain add-root-cert`
  works). An unanswered ATT alert suspends the webview's JS and survives relaunches;
  `simctl erase` clears it. Verify servers: `ys-resume-verify`, `ys-sw-kill-verify`.
- **2026-07-24** — **Leaving a screen after the phone has been locked no longer stalls**
  (BUILT on `fix/quiz-flow-ux`, NOT MERGED). The native app is a webview onto the live site
  (`capacitor.config.ts` → `server.url`) with no local bundle and no service worker, so every
  screen is a network fetch. Lock the phone and iOS kills the sockets, sleeps the radio, and
  Next's router cache goes stale — and nothing was prefetched during a game, because the game
  screen hides `BottomNav`. Measured cold on prod: DNS 480ms, TLS 1.46s, **TTFB 1.89s** on
  wifi, against 0.32s warm; several seconds on a phone waking its radio. Three changes:
  (1) `ResumePrefetch` warms `/`, `/play`, `/versus`, `/matchweek` on foreground after a 15s+
  absence (staggered 150ms, throttled to once a minute, listens to both `visibilitychange`
  and Capacitor `appStateChange`), so the DNS + TLS + RSC cost is paid during the resume
  instead of on the tap; (2) `loading.tsx` added for `/play` (inherited by every game route),
  `/versus` and `/matchweek` — previously only `/` and `/profile` had one, so tab taps held
  the old screen frozen; (3) `BottomNav` lights the tapped tab on **pointer-down** and sweeps
  a 2px bar while the route is in flight. The highlight has to be set on pointer-down in its
  own event: React entangles a state update made in the same event as a transition, so it
  renders but does not commit until the transition resolves — verified with a delayed RSC
  fetch, where the tab never lit. Still open: no service-worker app shell, so the app
  re-downloads the site on every cold start.
- **2026-07-24** — **Rating asks are now counted** (migration 102 applied to prod; app code
  BUILT, NOT YET MERGED). New `review_prompts` table logs every ask shown, with surface,
  variant and outcome. Until now the post-game rate ask was gated only by a localStorage
  stamp, so it left no server-side trace at all — App Store ratings had no denominator, on
  any surface, ever. Two behaviour changes with it: the ask no longer requires a **win**
  (any finished Game counts — the old gate skipped bad runs, and could never fire on a
  returning player's first Game on a new phone, since the points delta needs a prior
  on-device snapshot), and the cooldown drops 45 days → **14**. Eligibility moved to
  `/api/review-prompt`, which also enforces **Apple's 3-popups-per-365-days cap** in our own
  code: past the cap `SKStoreReviewController` silently draws nothing, so we serve the soft
  card instead of logging an ask nobody saw. Backfilled the 32 WC-campaign asks — the only
  review history that existed.

- **2026-07-23 (pm)** — **Sign In/Up on every tab** (shipped `97a8c19`). App installs could
  not find sign in. A guest landing on **Play or Premier League got no auth entry point at
  all** — neither tab rendered one — and the only one anywhere was on the marketing home page,
  where the "Sign In" link was `hidden sm:block`, so a phone showed nothing but "Sign Up". A
  returning player reinstalling from the App Store had nothing that looked like a way back
  into their account. New `GuestAuthButton`, mounted once in the root layout: a fixed pill top
  right, signed-out only, every route, carrying `?next=` so sign-in returns you to the tab you
  were on. Hidden on `/auth/*`, on the home page (its header has its own), and while a run is
  on screen — it honours the same `useGamesNavHidden` flag GamesNav does, so it never floats
  over a quiz timer. **GamesNav gains right padding for guests**: that tab row is a horizontal
  scroller and the five tabs slid under the button without it. Home now reads **"Sign In/Up"**
  in the header and the hamburger shelf; the separate desktop-only "Sign In" is gone, since
  `/auth/sign-in` handles both and its own heading is "SIGN IN OR SIGN UP". Verified signed
  out, tab by tab, on a real build. Also clears three em dashes from the Today's Game
  subtitles in `daily-game.ts`, which render on the signed-out home hero above the fold.
- **2026-07-23 (pm)** — **Game graphics shared to the home explainer** (shipped `b249e3f`).
  The Perfect 10 / Higher or Lower / Guess the Player mock screens lived only on `/games`;
  they now render in the signed-out home "THE GAMES" section too, which was bullets-only.
  Extracted to **`src/components/games/GameVisuals.tsx`** (`GAME_VISUALS`, keyed by the `GAMES`
  registry key) as one source both surfaces import, so the two can't drift — same pattern as
  the game list itself. Quiz and 38-0 have no mock (they get step carousels on `/games`) and
  stay bullets-only, no empty picture slot.
- **2026-07-23 (pm)** — **Games page** (`/games`, shipped `693a278`). `/how-it-works` became
  `/games` and now covers all five titles, with the old URL kept as a permanent redirect
  (inbound links from the blog layout, league-join, sitemap and llms.txt). Tabs render from
  the **`GAMES` registry** per §1.1, so adding a game grows a tab with no marketing edit; the
  page previously had tabs for Quiz and 38-0 only, which was the retired flagship framing on
  a page called THE GAMES. Perfect 10 / Higher or Lower / Guess the Player get detail panels
  **with mock-screen graphics** (the P10 tower, an H-or-L pair with one number hidden, GTP
  clue chips over four options), each in its own §5C section colour. **Halftime Quiz and
  Fantasy get their own sections**, not tabs — neither is playable, so they can't sit in a
  strip whose other entries say play now; both dated 21 Aug. Fantasy copy verified against
  the engine on `fantasy/advice` (`SQUAD_SIZE` 15, `BUDGET_TENTHS` 1000, `MAX_PER_CLUB` 3,
  `WEEKLY_FREE_TRANSFERS` 1 with earned credits on top), not taken from the hold screen.
  Halftime stays clear of the play-along-during-a-fixture claim §5A.1 forbids. Copy gate
  carried to this page: 15 em dashes, 3 "mates" and the last World Cup references gone.
- **2026-07-23 (am)** — **Signed-out home rewritten around the rank** (shipped `b024193`,
  doc `a24c6f9`). Headline is now **YOUR FOOTBALL KNOWLEDGE. RANKED.** An earlier cut said
  "FIVE FOOTBALL GAMES" and was rejected: **never put a count of games in a headline** — it
  reads as a ceiling and goes stale the day a game ships. Breadth moved to the eyebrow so the
  headline keeps one promise. New `GamesHeroCard` + `GamesExplainer`, both rendering from
  `GAMES`. Removed the 01-04 "HOW IT WORKS" steps (the 38-0 arc as if it were the app), the
  "SPEED SCORED" demo section and its 45s interval that ran on every signed-out load, the
  duplicate game tiles and the invented league activity rows. `WorldCupCountdown` →
  `SeasonCountdown` (PL GW1): the old one passed zero on 11 Jun and had rendered "THE CUP IS
  LIVE" every day since, including the four days after the final.
- **2026-07-23 (am)** — **Guest-flow fixes from a `/ux-walk`** (in `b024193`). Today's Game
  moved above the hero — it sat **1280px** down, 1.6 screens below the fold, and was the only
  thing on the page a guest could do without committing. `/38-0` lands on Premier League, not
  a finished World Cup. The WC edition strip is signed-in only: a guest's first ever visit
  opened with "34 days to catch up" and 35 CATCH UP chips. Guests are no longer told "your
  first score counts on the leaderboard" 40px above "sign in first to save your score", which
  contradicted it and was false for them.
- **2026-07-20 (pm)** — **Versus guest dead-end fixed** (`src/app/versus/page.tsx`, working
  tree, not yet committed). Signed-out users hitting Versus got a bare sign-in gate with NO
  BottomNav (guest nav vanished — trapped) and no create-account CTA. Now: guest BottomNav
  stays, primary **CREATE FREE ACCOUNT →** + secondary **SIGN IN** (both to
  `/auth/sign-in?next=/versus`, that page handles both), copy sells the mode. Verified in
  browser desktop+mobile, no console errors.
- **2026-07-20 (pm)** — **Versus psychology-audit fixes** (branch
  `versus/hide-shadow-reveal`, MERGED to main 2026-07-20). Live numbers showed the constraint: 87 of 103
  quiz h2h matches in 14d were shadows (9 human), 255 solo players vs 59 versus players,
  20 new friendships. Fixes: **solo result screen ends on a "Beat someone's score" rail**
  (`BeatScoreRail` + `/api/versus/recommended` + `lib/versus/recommend.ts`) — up to 3
  quizzes the player has NOT attempted where other players' replayable runs are waiting
  (same bar as the shadow pool: score>0, answers log ≥3), each card naming the top runner
  + their score ("@x scored 4,850 · 12 others played"), hero card with faces + top/median;
  tap → `/versus/find` pinned to that pack — fair (unseen questions) AND guaranteed to
  match (those runs ARE the pool). Founder killed the first cut (same-quiz pin — "you'll
  just get the same answers again"; rigged vs a blind shadow). Empty pool → plain
  unpinned FIND AN OPPONENT fallback. Live pool check: top pack 101 players / 5,850 top
  score, so recommendations exist for essentially everyone. Live-now strip's second tile
  falls back to a real **"Matches this fortnight"** aggregate (`matches14d` on
  `/api/versus/activity`) when today's counts are under the show-threshold; the empty
  rivalries section now shows a **first-rivalry teaser** ("play the same player twice")
  instead of vanishing; **shadow opponents get the standard add-friend card** on the
  scorecard (consistent with "they played each other").
- **2026-07-20** — **Shadow matches: the honest reveal is RETIRED** (branch
  `versus/hide-shadow-reveal`, MERGED to main 2026-07-20). Founder call: never disclose the replay — the
  scorecard now presents a shadow match as a normal head-to-head result ("they played each
  other"). The reveal panel ("You just played X's real run from {date}" + PLAY THEIR RUNS /
  CHALLENGE LIVE) is deleted from `/play/[roomId]`; matchmaking chain, persona overlay,
  timing replay, keep-playing panel all unchanged. Owner-side revenge push + the
  `/versus/shadow/[userId]` library still use "run" language — deliberately untouched
  (founder gave no preference; revisit if inconsistent).
- **2026-07-20** — **Perfect 10 gets its own share card (founder)** — a shared Perfect 10
  link used to unfurl the platform-wide YourScore card, which said nothing about the game.
  New `/api/og/perfect-10` renders **the tower itself**: ten tapering rungs, gold where the
  player named the answer, dark where they didn't, plus topic title, PERFECT 10 / TOWER
  FALLS verdict and points. **No names ever appear on the card** (rungs are lit/unlit only)
  so a posted result cannot spoil the list — same rule `buildShareText` follows. Modes:
  `?c=<share_token>` = verified scorecard · `?list=<id>&s=&f=` = **guest** scorecard
  (guests have no attempt row, so their result rides in the link; self-reported and
  forgeable, which is fine as nothing is scored off an image) · bare = promo card with an
  **empty** tower (ten blanks to fill — a fully-lit promo read as somebody's 10/10).
  `page.tsx` is now a thin server shell exporting `generateMetadata` (only a *page*
  receives `searchParams`, which is what lets a challenge link unfurl that player's own
  tower); the game moved unchanged to `Game.tsx`.
- **2026-07-19** — **Home link-preview card redesigned to sell the whole platform
  (founder)** — `/api/og/home` (the og:image every yourscore.app unfurl shows) no longer
  promotes only 38-0: "The Home of Football Gaming" headline + a fanned trio of mocked
  game cards in the app's real design language (38-0 green / Perfect 10 gold with a real
  list topic / Quiz teal). Bebas + DM Sans TTFs now bundled in the route for Satori.
- **2026-07-18** — **Perfect 10: official result card + spoiler-safe X share + back to
  the picker (founder)** — the results screen is now a proper scorecard (topic title,
  PERFECT 10 / TOWER FALLS verdict, big points, n/10 named, then the tower) with the
  house "SHARE YOUR SCORECARD / Post it on 𝕏" CTA (guests included — their link points
  at the game mode; signed-in posts carry the challenge link). **The share text names
  only ~50% of the player's found answers** (every other one, spread down the tower;
  the rest stay `•••` and missed rungs are NEVER revealed) so posting can't give the
  list away — same text for X, native share and copy. New "PICK ANOTHER GAME MODE →"
  button returns to the intro's Game-modes picker (whose primary button reads "SEE MY
  RESULT" once that mode is done, since finished modes can't be replayed).
- **2026-07-18** — **Versus instant match: real opponents before "CPU" + matched-lobby
  cleanup (founder: matching with "CPU" after Find an opponent "is not what should be
  happening")** — the quiz bot fallback now EXHAUSTS shadows before the literal CPU:
  fresh shadow → least-recently-met RERUN (heavy players had emptied the fresh pool,
  which is exactly why the founder kept landing on "CPU") → other published packs
  (generic find only; a pinned find keeps its quiz) → CPU only for a truly empty pool.
  **Same day (follow-up ruling): the CPU seat is never shown as "CPU" anymore** — it
  presents as an imaginary player (deterministic per-room name + generated avatar,
  `cpuPersona()`), across the found screen, lobby, live header and scorecard.
  Resumed bot-seat rooms surface their shadow persona (not the bot profile), and the
  server tags matches `kind: human|shadow|cpu` so the AppsFlyer chain is measured, not
  guessed. Matchmade "Instant Match" lobbies (and any full lobby) no longer show the
  invite-code/QR block — you already have your opponent. Fix: `/play/[roomId]` headers
  (lobby / live / completed) got `pt-safe` — on the wrapped iPhone build the back
  control sat on top of the status-bar clock, leaving players stuck on the lobby page.
- **2026-07-18** — **Perfect 10: topics are GAME MODES, daily framing dropped
  (founder: "forget this daily thing")** — the intro is now a topic picker: "Game
  modes" lists every served list (selected one highlighted, PLAY / n-of-10 / score
  badges), no dates anywhere, no "Previous days" / "today's list" / "latest" copy.
  Server model unchanged: `day` still gates+orders what's served (ops concern only,
  never shown); state/guess/hint/challenge APIs untouched.
- **2026-07-18** — **Games nav is ONE persistent bar (founder: "it's a NAV, not a
  page selector")** — `GamesNav` moved into the root layout: mounts once, shows on
  the five game-section routes, pages swap below it with zero remount/flash
  (verified: same DOM node across all five tab hops). Game pages hide it mid-run via
  `useHideGamesNav`; height published as `--games-nav-h` for the Quiz hub's sticky
  header. Active tab glides to centre on switch. Per-page switcher copies deleted.
- **2026-07-18** — **38-0 competition tabs cleaned up (founder)** — same treatment as
  the quiz filters: the emoji pill-box (🏆 WC Mastermind / ⚽ Premier League / 🇪🇸 La
  Liga / Leaderboard ✓) is now clean underline text tabs, no emoji or badges, each
  competition keeping its accent as the underline. The secondary action pills (Live
  H2H / My Teams / H2H Ladder) are links, not filters — unchanged.
- **2026-07-18** — **No back buttons on game sections (founder)** — games are tabs, so
  the switcher is the navigation: removed the 38-0 hub's "YourScore" BackPill and the
  three game intros' Back buttons; results CTAs relabelled "MORE GAMES" (the games
  aren't Quiz anymore). The in-game exit Back on an active Perfect 10 run stays —
  it's the only way out mid-game.
- **2026-07-18** — **Perfect 10, Higher or Lower, Guess the Player are separate games
  (founder ruling)** — the GameSwitcher is now five games (Quiz | 38-0 | Perfect 10 |
  Higher or Lower | Guess the Player), each with its own section; the switcher renders
  on each game's intro as its section header (never over gameplay), scrolls and
  auto-centres the active tab. The GAME TYPES tile block was removed from the Quiz
  hub. Higher or Lower recoloured to orange #ff7800, Guess the Player to blue #4fc3f7
  (own identities — they'd been borrowing Quiz teal / 38-0 lime). §9 updated.
- **2026-07-18** — **Perfect 10: intro/results scroll snap-back fixed** — the Jul-17
  "pin the board" fix registered its `window.scrollTo(0,0)` pin for the page's whole
  life, but mobile URL-bar collapse fires `resize` MID-SCROLL, so scrolling the intro
  ("Previous days") or results screen snapped back to the top. Pin now applies only in
  the `playing` phase (gameplay still never scrolls); also reset the keyboard-detection
  height baseline on `orientationchange` so rotating to landscape no longer reads as a
  permanently-open keyboard. Repro + fix verified headless (Playwright: scrollY survives
  a resize event; pre-fix build snapped 250→0).
- **2026-07-18** — **38-0 moved under the Play tab (founder ruling)** — the Play tab now
  holds both games via a top **Quiz | 38-0 game switcher** (`GameSwitcher` component) on
  both hubs (`/play`, `/38-0`); routes frozen, switcher navigates. Bottom nav unchanged
  otherwise (Home · Play · Versus · Premier League · Profile); Play highlights on
  `/38-0`. §9 Navigation Canon updated to current truth. **Same day, v2 (founder
  direction):** switcher restyled to Coral-style icon tabs (icon above label, per-game
  colour + underline); the /play solo filter pills (emoji + caps + count badges)
  replaced with clean underline text tabs (Featured / World Cup / Club / Records, no
  counts); Featured tab now leads with a **full-width marketing hero tile** — the lead
  featured pack's cover art with a FEATURED badge + PLAY, falling back to the plain
  grid when the lead pack has no cover.
- **2026-07-16** — **Perfect 10 SHIPPED** — third Quiz game-type: name everyone in a ranked
  top-10 list. Floodlit-tower UI at `/play/game/perfect-10`, daily list (Europe/London),
  hints/strikes, async challenge links, all-PL-history typeahead (4,669 names). Server-only
  answers (mig 85, RLS deny-all). Lists gate-verified before a `day` is assigned. See the
  Confirmed preamble for the full mechanics + gotchas (SportMonks topscorers unreliable;
  season-id alias trap; `scripts/lib/anthropic.mjs` first committed here).
- **2026-07-16 (pm3)** — **Legacy question-bank triage (APPLIED TO PROD).** The bank predates the
  gate, so it was measured against it. Results: **2,823 active → 1,205 (43%) were tagged
  expert/master and are UNREACHABLE** (`/api/quiz/start` is typed `"easy"|"medium"|"hard"` and
  draws 6/6/3 — it can never ask for them). Re-rated the whole bank with the independent rater
  ($0.86): **93% of the "unreachable" genuinely ARE hard** (only 84/1,145 recover), and **554 of
  1,520 served questions (36%) were at the WRONG difficulty** — the old rating was self-declared
  by the author. Applied: **525 difficulties fixed · 73 stranded recovered as easy/medium · 1,070
  left stranded** (genuinely hard AND unverified — recovering them would add unverified questions
  to our most oversupplied tier) · **158 rotting questions retired** (fail temporal/specificity:
  "Reading's MOST RECENT PL season", "who IS the all-time CL scorer"). **The easy shortage is
  STRUCTURAL, not mislabelling** — re-rating everything moves easy 5%→6%; only new authoring fixes
  it. Deleted `/api/cron/reclassify`, which reclassified difficulty from `times_correct/times_answered`
  — the thing the founder explicitly forbade (unscheduled, so harmless, but a landmine).
  **`times_answered` IS incremented** — inside the Postgres RPC `record_quiz_results` (grepping
  `src/` can't see it) — but it's starved, not missing: max 4 answers on any question, and
  `user_question_history` holds 314 rows from ONE user, because `/quiz/create` COPIES bank
  questions into a `quiz_packs` JSONB snapshot and pack plays never report back to the bank row.
  New: `scripts/quiz-factory/{audit-live,rerate-live,clean-live}.mjs`.

- **2026-07-16 (pm2)** — **Quiz factory rebuilt FACTS-FIRST** (founder's call; branch
  `quiz/content-factory`, not on main). The old order was backwards: an author searched the web
  and wrote 30 questions, then a verifier did 30 *more* web searches to check them. Now:
  **gather verified facts → author ONLY from that sheet → cheap consistency check (no web) →
  independent difficulty rating**. Web search happens ONCE per category instead of twice per
  question, and a question derived from a verified fact can't be a hallucination — the worst
  case is a misreading, which is caught without a search. Projection **$346 → ~$58** for the
  full 20-club bank. Facts are reusable across categories and packs. The trade-off, accepted
  knowingly: correlated failure (one bad fact poisons every question from it), mitigated by
  **source tiering** (`scripts/quiz-factory/sources.mjs` — tier 1 governing bodies/official
  club sites, tier 2 major press/Wikipedia/Transfermarkt, everything else = NO source, fact
  dropped) and by the founder reviewing the ~30-fact sheet rather than 30 questions.
  - **Difficulty model** (`scripts/quiz-factory/difficulty.mjs`): assigned **a priori**, never
    from live player answers — club questions are answered by that club's fans, so accuracy
    would measure fandom not difficulty, scores would stop being comparable, and a question
    everyone fails is often *wrong* rather than hard. (`times_answered`/`times_correct` keep a
    job as a **quality alarm**, not a difficulty knob.) **Three levels only** — `/api/quiz/start`
    is typed `"easy"|"medium"|"hard"` and draws 6/6/3, so expert/master are **stranded: 1,101 of
    2,447 club rows (45%) can never be served**. A separate rater (never the author, which drifts)
    scores against a fixed **anchor set**, plus deterministic guards (tight numeric options ⇒
    never easy; 10+ seasons old ⇒ never easy).
  - **Specificity gate** (`checkSpecificity`): now that we hold league AND European data for the
    same club+season, "Arsenal's top scorer in 2015/16" has two answers — every scope-dependent
    question must name the competition.
  - **Category swap: Transfers & Rivalries → European Nights.** Transfer fees aren't in
    SportMonks at any tier (most expensive category, and fees are genuinely disputed — the gate
    killed a Bellingham question over £88.5m-base vs £115m-with-add-ons). European Nights is
    fully groundable off the finals index and is the better fan material.

- **2026-07-16 (pm)** — **SportMonks subscription upgraded to European club tournaments.**
  Accessible competitions are now exactly five: Premier League (8), Champions League (2),
  Europa League (5), Europa Conference (2286), UEFA Super Cup (1328) — all back to 2000/01.
  **No domestic cups** (FA/League Cup remain web-only). `scripts/lib/sportmonks.mjs` gained
  `europeanFinalsIndex()` — every European final since 2000 (67 of them), built once (~200
  calls) and cached, so a club's honours is a free lookup. Getting a cup winner needs two hops
  (fixtures are paginated, the final is never on page 1): `/stages/seasons/{id}` → the stage
  named `Final` → `/fixtures?filters=fixtureStages:{id}` → `participants[].meta.winner`.
  Club fact sheets now carry European honours, so History & Honours grounds ~60% (was ~35%)
  and the full 20-club bank projects at ~$207 (from ~$346 all-web). Spot-checked green: UCL
  23/24 Real Madrid, 18/19 Liverpool, 20/21 Chelsea, UEL 18/19 Chelsea.

- **2026-07-16** — **Quiz factory: SportMonks grounding (the cost fix) + club-bank runner**
  (branch `quiz/content-factory`, NOT on main). `scripts/lib/sportmonks.mjs` builds a
  disk-cached PL fact sheet per club (final tables + points + per-season top scorers, 2000/01→,
  league 8). The fact-check gate now grounds BOTH authoring (`authorBankGrounded`, no web
  search) and verification (`verifyAgainstFacts`, no web search) in that sheet wherever it
  covers the question, with web fallback for what it doesn't. **Measured: Arsenal × Modern-Era
  = $0.12 with zero web searches** (vs ~$4.32 all-web); full 20-club bank projection $346→$222.
  `scripts/quiz-factory/run-bank.mjs` fills the club question BANK (`questions` rows, drawn per
  play — NOT packs), 4 locked categories (History & Honours / Legends / Modern Era / Transfers
  & Rivalries), easy-skewed; default mode is a zero-spend cost projection. `audit-bank.mjs`
  audits the live bank — which turned up FABRICATED questions still active (e.g. "Haaland PL
  goals for Man City 2010-11"), not just staleness, and a 5%-easy / 74%-hard difficulty skew.
  Bank not filled yet — awaiting founder's go on scope.

- **2026-07-15** — **Retention tracking: `ReturnPlay` event + durable device id** (analytics
  plumbing, no user-facing surface). `ReturnPlay` fires once per device the first time a player
  plays on a later calendar day than their first-ever play — the D2+ "they came back" signal,
  fanned out to X/Meta/TikTok/Snapchat/GA4/Vercel/AppsFlyer so ad platforms can finally build
  repeat-player audiences + lookalikes off retained users (they previously optimised for first
  play/signup only). Pure logic in `src/lib/analytics/returnPlay.ts` (unit-tested); fan-out in
  `trackGame.ts`; native arm `afReturnPlay`. Also: a durable anonymous `ys:did` device id, saved
  to new `profiles.device_id` at signup (migration 81, first-touch) so guest activity can later
  be linked to the account. X arm is gated on `NEXT_PUBLIC_X_RETURNPLAY_EVENT_ID` (unset →
  no-op until the X event is created). Phase B (stamp device_id onto guest play rows) still TODO.
- **2026-07-14** — **Quiz content factory** (branch `quiz/content-factory`, ⚠️ NOT on main,
  migration 80 NOT yet applied). Themed packs on a schedule, with approval decoupled from
  release. **The pack lifecycle is now three states**: `draft` (invisible) → approved +
  scheduled (`approved_at` + `release_at` set, still invisible) → `published` +
  `rotation_active` (live). `status='draft'` was always permitted by the CHECK but nothing
  ever wrote it — migration 80 activates it and adds `release_at` / `approved_at` /
  `approved_by` / `theme`.
  - **The factory** (`scripts/quiz-factory/`, weekly VPS cron): pick theme (calendar peg →
    football news → evergreen backlog) → author OVERGENERATED grounded candidates → **the
    gate** → select 15 → deterministic shuffle → write as a draft. Never publishes.
  - **The gate** (`scripts/quiz-factory/verify.mjs`) is the load-bearing part. The bank holds
    2,823 active questions and **31,541 retired** — every `source='generated'` question ever
    written was binned, only `data-grounded` survived. So: Stage 0 (free) rejects temporal
    claims, hedge/duplicate/mixed-type options, and near-dupes against the live bank; Stage 2
    sends each survivor to an **independent** verifier in a fresh context that is NOT told the
    author's answer and must derive it itself and cite a URL — disagreement, ambiguity, no
    source, or an unconfirmed time-sensitive claim all DROP the question. The citation is
    stored in `questions.verification_note`. **A high drop rate is the gate working.**
  - **Review**: `/admin/quiz` — pack cards, every question with its source link. Approving is
    the only way out; `scripts/release-packs.mjs` refuses to publish `approved_at IS NULL`.
  - **Release** (`scripts/release-packs.mjs`, daily VPS cron): flips due+approved packs live,
    pushes via `/api/internal/notify-release` → `notifyUsers()`, emails via `segments.mjs`.
    Idempotent (the UPDATE is its own guard). **Approve nothing → ship nothing**, and it
    Telegrams the drought rather than failing silently. Email self-throttles to ~1.75/week
    per person via the existing frequency cap, so an every-other-day cadence can't burn the list.
  - Lives on the VPS, not Vercel, because `RESEND_CAMPAIGNS_API_KEY` (campaign email) is
    referenced nowhere in `src/` and transactional email is over quota.
  - Also extracted: `scripts/lib/question-text.mjs` (was copy-pasted 4×; must stay in lockstep
    with `src/lib/questions.ts` + migration 67's unique index), `scripts/lib/shuffle-options.mjs`
    (byte-identical extraction from `seed-daily-quiz.mjs`), `scripts/lib/anthropic.mjs` (one
    client + **per-call cost accounting** — web search is the dominant cost and was invisible).
  - **Proven live** (migration 80 applied to prod): state machine 7/7 via
    `scripts/verify-pack-release.mjs`; full 2-pack authoring run built 2/2 with a **23–31%
    gate drop rate** (healthy — the gate is cutting, not rubber-stamping) at **~$3.66/pack**
    (verification = 80% of cost). Registered in the content-dash `registry.json` (weekly
    factory + daily release). ⚠️ VPS cron entries + git commit still pending.

- **2026-07-13 (pm)** — **UI-audit approved fixes** (docs/AUDIT-2026-07-13-ui-first-impressions.md;
  founder walkthrough): site tagline standardized to **"The Home of Football Gaming"** (root
  title/OG/twitter); /how-it-works scoring is **top-line only** (founder: no explicit point
  tables — exact bands stay in-game; fake +200pts/45s copy gone, "Opening Day" demo refreshed);
  **WORLD CUP MASTERMIND title no longer clips** on 375px (fluid clamp in DraftHubHero); landing
  footer gains **Privacy / Terms / Blog** links; **finale week staged**: WcFinaleStrip ("THE
  FINAL — IN N DAYS · board freezes at full time") on the WC picker + season board, self-hides
  after Jul 19. £100 board copy: founder ruled **no change**.
- **2026-07-13 (pm, batch 2)** — **UI-audit round 2 (founder approve/decline)**: landing
  truth pass — the fabricated live-match teaser ("2 watching"/"who's live in a match") REMOVED,
  retired "lose and rebuild" → "lose and go again", the fake match-picking fixture cards
  (June-dated, "+340 pts earned") → real game-result cards (Quiz / 38-0 / Quiz Battle feeding
  one table, evergreen); hero subline now decodes 38-0 ("go 38 games unbeaten"), "Join a league"
  dropped from the hero CTA stack, contradictory "No app needed" caption reworded; **"Challenges"
  → "Quiz"** on public nav/card/footer (locked vocab); footer gains Privacy/Terms/Blog; **daily
  World Cup quiz cards no longer mislabeled "All-Time Records"** (RecordsCard derives "World Cup
  2026" from isWorldCupPack). DECLINED: #7 (keep the illustrative "The Mates" mock leaderboard),
  #10 (desktop tab-bar pass), #14 (hide low debate vote counts). NON-ISSUES (browser-pane render
  glitches, not real defects — DOM verified): the "blank landing screen" and "sign-in white
  logo box". FLAGGED for founder: one stale pack description (id 0f8020c2… "Big Kickoff") — prod
  DB copy write was permission-gated.
- **2026-07-12** — **Guest quiz "You" row + save-your-score claim** (render-only on the
  guest's device — never written to others' boards; localStorage-held answers auto-claimed
  post-sign-up via solo-complete), **WC Mastermind position-targeted drafting** (tap an empty
  slot to scout it; ranked target verified server-side), and **streak-1 band retune 66–76 →
  70–80** (elite still gated at streak 5; no messaging changes). SHIPPED to prod.
- **2026-07-11** — **Product-audit fix batch** (branch `claude/yourscore-ux-audit-pe7e5y`,
  from docs/AUDIT-2026-07-11): win now EARNS the one-player swap again (`recordWin` sets
  `swapAvailable` — the result-screen CTA + team-page banner work again); loss CTA is
  "GO AGAIN →" (stale-team framing removed from UI + this doc); **guests get Practice vs
  CPU** (Quick Match is fully local); Quick Match playback has "Skip to result"; the £25
  giveaway sheet no longer auto-opens over scorecards (inline card opens it); **quiz
  multiplayer resilience**: any Lobby member can advance an overdue question (server
  watchdog + atomic claim in /api/room/next — a vanished host no longer stalls the game),
  refresh/foreground restores the in-flight question, guests hitting a game link get a
  sign-in gate instead of an infinite spinner, spectators are no longer enrolled as
  players, failed answers surface an error + retry; home streak now counts WC-run days
  and lost its limit(12) corruption; PostHog mounted (env-gated, EU host); ~12 routes got
  the fetchCache guard; validate-email rate-limited; realtime kill-switch env-backed;
  Sentry PII off; pinch-zoom re-enabled; sign-up prompts return players to their context
  (`?next=`); h2h accept links full sign-in options; branded global-error screen.
  ⚠️ Quiz-loop changes need an end-to-end multiplayer run before merging to `main`.
- **2026-07-10** — **"Continue with Facebook" built, env-gated** (e129380): renders on the
  sign-in panel between Google and email once `NEXT_PUBLIC_FACEBOOK_LOGIN=1` is set in
  Vercel. NOT live yet — needs a Facebook app (Meta developers console) + the Facebook
  provider enabled in Supabase first. OAuth redirect URI for the Meta app:
  `https://auth.yourscore.app/auth/v1/callback`.
- **2026-07-07** — **Play-level acquisition attribution** (mig 75): WC runs + solo quiz
  attempts now store first-touch `source`/`utm_*` (client sends localStorage `ys:acq` at
  creation; server sanitizes) — plays-per-platform/campaign is now a direct DB query,
  covering guests and pre-capture signups. Paid ad URLs on Meta/TikTok carry UTMs from today.
- **2026-07-06** — WC quiz answer bank is now **server-only** (audit C1): client draws
  answer-free questions via `/api/draft/wc/practice-quiz`; server grades from the seed —
  prevents offline pre-computation of the £100 board. (§5B)
- **2026-07-05** — **Anonymous debate voting** (guests vote device-keyed; sign-up gates the
  argument, not the ballot); **date-allocated debates** (`scripts/seed-debates.mjs` is the
  schedule); **debate share card** + `?pick=` one-tap vote funnel; **back-navigation retrace**
  (session nav trail + smart BackPill fallbacks); **Home v3** (progress card + week dots,
  rivalry module, featured quiz, behaviour rail). (§7 / §9)
- **2026-07-04** — **Daily Debates + discussion threads** (Versus phase 2); email
  **open/click engagement** capture via Resend webhook; Resend **unsubscribes** mirrored into
  `email_suppressions`. (§7)
- **2026-07-03** — **Public player profiles** (`/players/[id]`: record, battles, quizzes,
  add-friend); **Leagues Discover** round 2; email **deliverability** MX-check at signup +
  audience sweep. (§7 / §9)
- **2026-06-27** — **Push notifications LIVE** (opt-in via NotifyOptInCard; WC Mastermind daily
  push at personalized per-timezone send times) — no longer "tied to launch". (§7)
- **2026-06-17** — **Usernames as public identity** (`@username` replaces real-name display
  across profiles, challenge invites, and league tables). (§2)

> **Maintenance:** shipped a product change? Add a line here (newest first) and bump the
> Confirmed date. This list is what keeps the next session from being out of date.

---

## Detailed confirmation history

**Confirmed:** 2026-07-23 (**Home hero rebuilt: Today's Game shows its topic + crowd stats,
debate comments open to all, Mastermind resume prompt removed.** Branch `fix/quiz-flow-ux`,
migration **102 APPLIED to prod**.
**Today's Game tile** is now two halves: cover art on top, a live stats strip underneath —
players / average score / % who got the hardest question. Numbers come from two new SQL
aggregates (`get_daily_pack_stats`, `get_daily_p10_stats`, migration 102, `security definer`,
anon-executable so the logged-out hero can use them too). The strip shows the hardest
question's PERCENTAGE only, never its text, so the tile can't spoil a question the player is
one tap from being asked; zero plays shows "Nobody has played it yet" rather than three zeros.
**Perfect 10 tiles lead with the list title, not the mode name** ("Perfect 10" alone read as a
menu entry). Root cause was real: P10 lists release in BATCHES, not daily, so most P10 days
have no row of their own — `src/lib/daily-game.ts` read only `day` and came up empty. It now
mirrors what `/api/games/perfect-10` actually serves (`loadListForDay ?? loadLatestServed`).
Same bug was silently breaking the Perfect 10 **done state** on every non-release day; fixed.
**Today's debate:** the comment thread is now INSIDE the debate card (one tile, not two) and
is readable by everyone, voted or not — posting is what voting buys you (`canPost` on
`DiscussionThread`, plus an `embedded` mode that drops its own frame). "DRAG A FRIEND IN" and
"THE ARGUMENT" buttons are gone. The sign-up pitch is now opt-in (`withSignUpPitch`) and OFF
inside the app, where it was flashing in before the client session resolved.
**Home no longer surfaces an active Mastermind run at all** (founder call) — the mode tile is
the only way back in. **STILL OPEN:** recommended packs have no browse surface, so anything
not in the rec strip is unreachable and unplayed, and club packs still fall back to crests
instead of real covers.)

**Also confirmed:** 2026-07-23 (**Quiz Battle match feel: live scoreline, self-starting
matches, a verdict you can actually read.** Branch `fix/quiz-flow-ux`, committed, **not on
main**. Four fixes, from a `/ux-walk` of Versus plus the founder's own play-test, all inside
the live match rather than the surrounding menus.
**1. The scoreline is always on.** `LiveScoreline` in `src/app/play/[roomId]/page.tsx` renders
in the room header, which moved `z-30` → `z-[60]` so it paints ABOVE the question overlay
(`QuestionCard` is `fixed inset-0 z-50`) instead of being blurred out behind it; the sheet
dropped to `84dvh` to leave it clear. Reads `You 150 · BEHIND · 375 king126` — leader lime, you
red when trailing, gold when level; 3+ players reads you vs the current leader with a `+n`.
Mid-question you could previously see the timer and the answered-count but not a single score.
**2. Instant matches start themselves.** Matchmaking had already found and seated the opponent,
so the lobby asked you to confirm what you'd just confirmed on the "opponent found" screen. A
3s countdown auto-fires `handleStart`, still tappable to skip, scoped to `INSTANT_MATCH_NAME`
rooms only — share-code and public lobbies keep the manual Start, because there you genuinely
are waiting for somebody. A failed start clears the countdown so it can't strand on
"Starting in 0…".
**3. The verdict lands.** The CORRECT/WRONG panel moved ABOVE the four options (it sat below
them, under the fold on a phone) and `triggerEarlyAdvance` holds the card open
`REVEAL_HOLD_MS = 1400` before advancing. **The hold is the real fix:** early-advance fires as
soon as every seat has answered and a shadow has always already answered, so the panel got ZERO
frames. Measured live: visible **1,439ms** answering last, **2,040ms** answering first, **0ms**
before.
**4. Speed is visible.** The verdict reads `CORRECT! +100 2.7s` — two players can both be 100%
and finish 200-100 on answer time alone. Also: a selected-but-unrevealed option went lime →
neutral white, so lime now only ever means "this was correct" (they were the same colour, so a
locked-in pick looked exactly like a right answer).
**Verified in a live shadow match** on the Newcastle United pack, not merely built.
⚠️ **Never run `next build` while a dev server is up** — they share `.next/`, the prod build
clobbers the dev chunk graph, and the symptoms are 404s on real routes, "missing required error
components, refreshing…", and a game that freezes mid-round. `rm -rf .next` and restart.
**DONE same day — Versus Quiz Battle now leads with clubs, most-supported first.** Founder's
rule: featured order = club popularity among our own players. **Deliberately NOT done by
flipping `quiz_packs.featured`** — that flag is shared with the home hero
(`src/lib/daily-game.ts:211`) and the solo Quiz hub (`/api/quiz/packs`), and the founder chose
(2026-07-23, given both options) to leave the home page exactly as it is. So the ordering is
local to `/versus/quiz`: new public route **`/api/clubs/popularity`** (service-role read,
`fetchCache = "force-no-store"` or Vercel pins it forever, CDN `s-maxage=3600`) counts DISTINCT
`user_id` per club — rows would double-count a fan who declared in two seasons, since the PK is
`(user_id, season_id)`. Live: Man Utd 133, Liverpool 123, Arsenal 77, Chelsea 49, Spurs 41,
Man City 26, Newcastle 23, Everton 20, Leeds 20, Villa 16. Ties break alphabetically so the
order is stable request to request. **Name mismatch is real and handled:** `club_supporters`
says "Brighton & Hove Albion" and "AFC Bournemouth" where the packs say "Brighton" and
"Bournemouth", so both sides go through `clubKey()`; an unmatched club ranks last rather than
breaking the list, and an empty/failed fetch degrades to the old featured-then-newest order.
Verified: hero = Manchester United, rail = Liverpool, Arsenal, Chelsea, Spurs, Man City, and
the home hero is untouched. Also fixed: the Featured hero's "New" chip was hardcoded, so it
claimed New for a quiz you'd already played.
**"Find an opponent" with no quiz picked now deals a club quiz too.** `pickInstantPack` used to
fall straight to `featured = true` ordered by `created_at`, so an unpicked instant match always
served World Cup. It now tries `clubPacksByPopularity()` first (published + `rotation_active` +
`type='club'`, ranked by the same `rankClubs`/`clubKey` the picker uses — the pure logic lives in
**`src/lib/clubs/popularity.ts`** precisely so the two surfaces can't drift), then the old
featured-then-newest chain. The shadow ROAM was fixed with it: when the chosen pack has no
shadow run, it used to fall to the 5 newest published packs, which are all World Cup, so an
unpicked match landed back on the thing we were trying to move away from; it now roams the club
order first. A club nobody supports is filtered out rather than led with, and any failure here
falls through instead of blocking the match. Verified live: `/versus/find?game=quiz` with no
pack produced a **Manchester United** room (`type='club'`, `featured=false`).
⚠️ **`quiz_packs.featured` itself is untouched and still 12/12 World Cup** with 9 tied on
`featured_order = 0` — deliberately, because that flag drives the home hero and the solo Quiz
hub. Anything else reading `featured` still leads with the World Cup. Also open: the Quiz Battle club grid launches one
pack instead of opening the club, so **98 published club-topic packs are unreachable from
Versus**; Versus can battle only **79 of 428** published packs; and guests can play nothing on
the Versus tab — every tap is capture-routed to sign-in.)

**Previously confirmed:** 2026-07-22 (**Club pages + a batch of quiz-flow UX fixes shipped.**
Branch `fix/quiz-flow-ux`, merged to main.
**Club pages `/club/[slug]`:** the Quiz hub's Club tab used to send all 20 crest cards
straight into a single 2025/26 season-review quiz. It now opens a club page: crest, the
season-review pack, and four topic quizzes (History & Honours, Legends, Modern Era,
Rivalries) drawn from the verified club question bank. Built by pre-generating the topic
packs as real `quiz_packs` rows (`status='published'`, `rotation_active=false`,
`is_custom=false`, `created_by=null`, `metadata.club_topic=<slug>`) via
`scripts/club-pages/generate-topic-packs.mjs` (imports the draw from `src/lib/questions.ts`
so it can never drift from `/api/quiz/generate-custom`; dry-run by default, `--commit` to
write). **50 packs seeded to prod.** Real draw (fact_key distinctness) yields 50 of 80 club
x topic combos, not the 57 a raw row-count suggested: Arsenal / Liverpool / Man City / Man
Utd get all four topics, Forest gets one, most land at two or three; a topic that can't deal
15 shows a disabled card with an honest reason. Nothing new to generate or auth: `/api/quiz/packs`
still filters `rotation_active=true` so the hub grid stays 20, while `/api/challenges/pack`
serves any published pack, so guests play these on the existing play screen with the sign-in
wall only at save-score. Club-page payload at `/api/club-page/[slug]` (named `-page` because
`/api/club/[slug]` already belongs to Club Leagues). Every topic link carries `?pid=` because
two published packs are named "Brighton" and slug-only resolution is order-unstable.
**Quiz-flow UX fixes (from a `/ux-walk`):** results screen leads with PLAY ANOTHER and moves
save-your-score up under it (was two stacked share CTAs with the next-game route buried last);
Accuracy on the results screen is now questions-right, not score/maxScore (it disagreed with
"7/15 Correct"); AnswerButtons gets a `key` per question in all three quiz players so
`transition-all` no longer flashes a wrong option green on the next question; the username
prompt no longer mounts over hubs and games (it ate the first tap) and skip is once-ever in
localStorage; Featured drops the finished World Cup packs and the verified-competition card
reads FINAL STANDINGS not a pulsing LIVE; the quiz builder club grid no longer clips two-line
names or loses Birmingham City. Copy gate: "mate" to "friend" in 8 places, em/en dashes
stripped from shipped strings, home hero stops naming the delivery mechanism. **STILL OPEN:**
user-built quizzes and guest scores still have no home surface (the "your quizzes" list and
guest score memory are the next two pieces).)

**Previously confirmed:** 2026-07-21 (**Profile rebuilt around a FUT-style player card.**
Branch `feat/profile-player-card`, migration **82 APPLIED to prod**.
**The page:** a hero row — YourScore rank, accuracy, streak and Share on the left; the
**player card** on the right (rating, archetype, real club crest from `club_supporters`,
avatar, six attributes). Then the **ladder** (2 above / you / 1 below, progress bar, and a
concrete "18,150 pts overtakes tatty · a strong quiz run closes it"), the **medal shelf**,
**"where your points come from"** — which says out loud that daily quiz, World Cup and
seasons earn NOTHING toward Rank — and recent games.
**The card is rated on being a YourScore player, never one game:** KNO accuracy · PAC answer
speed · WIN record · CON streak · RNG breadth · SOC social. A new game feeds the existing six
rather than earning its own slot. Tiers Bronze/Silver/Gold/Icon; archetype = your leading
attribute, so two players on 84 read differently. **Nobody scores zero** — floor 38, a new
player is a real Bronze ROOKIE.
**25 medals** (`src/lib/medals.ts`), every threshold calibrated against the REAL distribution,
not instinct: 67% of players have a 38-0 win but only 0.7% have answered 100 quiz questions,
so the 38-0 ladder carries the volume and quiz tiers sit at 15/50/150. Rarity is the pride
mechanic and is printed on each medal. **Social medals deliberately absent — no player has 5
friends.** `Ever-Present` (30 days) has zero holders on purpose. Percentages are DATED
constants measured 2026-07-21; they drift, and a nightly job is the fix when wanted.
**Avatars:** 16 generated character portraits at `public/avatars/*.webp`
(`scripts/gen-avatars.mjs`), replacing the old object icons. Only 1 user had the old set.
**Gotchas:** a cross-origin URL in an SVG `<image href>` renders as a BROKEN TILE — 3,367 of
9,786 profiles are Google account photos, so the card layers the photo as an HTML `<img>` over
the SVG (`foreignObject` is worse: blank). Readable content must clear the badge taper or it
reads off-centre when it isn't. Card size is a `width` prop so a share/OG render can use full
size. Also: `profiles.games_played` is 0 on all 9,400 rows — never read it.
⚠️ **STILL OPEN — `yourscore_user_ratings` is wrong:** it joins `draft_standings` on
`league_id` only, ignoring `competition`, so **340 users get two ranks** and **280 have their
38-0 score split across PL/WC and never summed** (worst: `goat1993`, −114,000 pts). Untouched
— it changes real ranks and needs a product call.)

**Previously confirmed:** 2026-07-21 late (**First-launch onboarding tour + guest Versus preview SHIPPED
to prod.** A 5-step spotlight walkthrough (`SpotlightTour`, mounted in the root layout) that
navigates the real app: Play games row → Versus action cards → PL section bar → your rank
(signed-in only) → ends on Home spotlighting the Today's Game hero. Pulsing beacon on the
bottom-nav tab each step references; once-ever via `ys:tip:app-tour:v1`; Skip/Escape end it;
steps whose target can't be found in 3s skip silently; `?tour=1` = QA replay that never burns
the flag (dev also gets `window.__resetTips()`). **NEW USERS ONLY (founder-locked):**
signed-in requires `created_at >= 2026-07-22T00:00:00Z` (`TOUR_EPOCH` in `src/lib/tips.ts`)
— current customers never see it; guests only on a **fresh native install** (detected by
stamping `ys:tip:fresh-install:v1` at module load while `yourscore:onboarding:v1` is still
absent, i.e. before the first-run carousel marks itself) and only after that carousel
completes; web guests never. Storage errors fail closed in the safe direction per flag.
Gotcha shipped around: `scrollIntoView({behavior:"smooth"})` silently no-ops in some
webviews — all tour scrolls are `behavior:"auto"`, plus a throttled pull-back if the page
scroll-resets under an active step. **Also: guest `/versus` now mirrors the real first-time
hub** (welcome hero, action cards, choose-your-game, live activity/community/public-league
rails with real anon data; every tap capture-routed to `/auth/sign-in?next=/versus`; slim
create-account banner) — replaces the old sign-in wall so guests see the actual hub.)

**Previously confirmed:** 2026-07-21 (**WC Mastermind thank-you flow SHIPPED to prod** — migration 100
seeds `wc_thanks_prompts` with the 199 players who played >10 ranked WC days; on their next
signed-in visit they get a one-time "What would you like to see on YourScore?" modal (free
text → `product_feedback`, write-only mailbox RLS), then after ~600px of scrolling a one-time
App Store review ask (native star popup in the iOS app; card on iPhone web; desktop leaves the
ask unconsumed so it still fires on a later phone visit). `WcThanksPrompt` mounted globally;
dev previews `?preview=wc-thanks` / `?preview=wc-review`. Verified live: seed = exact cohort,
anon-curl returns nothing on both tables, test feedback row round-tripped. **Companion email
(copy LOCKED Jul 21) to the 190 non-suppressed cohort members is NOT yet sent — awaiting
founder go.**)

**Previously confirmed:** 2026-07-20 (**Club question bank: categories remapped + Rivalries filled 0→20 clubs.**
On branch `quiz/content-factory`, nothing on `main`.
**The remap:** 2,207 verified questions across 44 clubs were invisible to the category flow
because they carried six legacy labels while only 69 (Arsenal) carried the new four. 2,213
questions rehomed deterministically (no API cost); Season Performance / Records & Milestones
split by era (modern-era = 2015+). Backup + `--revert` on disk.
**Rivalries:** was zero for every club — 498 questions written across all 20 PL clubs, $21.49.
**The honest number is 6/20 dealable as a full 15-question quiz** (Arsenal, Chelsea, Liverpool,
Man City, Man United, Newcastle), not 20/20. Eleven clubs are blocked on `easy` alone; three
(Bournemouth 6, West Ham 7, Palace 11) are capped by distinct-fact supply — `fact_key` stops a
quiz reusing one fact, so **row count is not capacity**. See `scripts/quiz-factory/bank-status.mjs`.
**RESOLVED same day — 19/20 clubs now deal a full 15-question Rivalries quiz** (was 6/20;
was 0/20 before today). Two changes: (a) the difficulty mix is now a TARGET with top-up
rather than a hard floor (`fillToSize` in `src/lib/questions.ts`), and (b) a `--top-up`
research pass for the three fact-capped clubs — West Ham 7→28 distinct facts, Palace 11→33,
Bournemouth 6→14. **Bournemouth is the only club still short, by ONE fact**; 17 of its 25
researched facts were dropped as untrusted, so its rivalry material is genuinely scarce.
**The four topics are now LIVE in `/quiz/create`** (clubs only) and `/api/quiz/availability`
filters by category too — without that the builder would show a club's total count while
generating from one topic. Verified in-browser: Sunderland · Rivalries offers Generate,
Sunderland · Legends correctly refuses.
⚠️ **The easy shortage was a CALIBRATION artefact, not a content gap.** Difficulty
is rated for a *neutral* fan, but only a club's own fans pick that club's quiz. Newcastle and
Sunderland from the same derby, same tier-1 sources, zero facts dropped: Newcastle 2/9/16,
Sunderland **0/1/27**. No research produces a neutral-easy Sunderland fact, so the supply the
threshold demands does not exist at any budget. Relaxing the easy requirement for club quizzes
was the fix, and it landed: the mix is now a target, not a floor.
**Also learned:** grounded Modern Era authoring (SportMonks league tables) produces
*structurally* zero easy questions — positions/points/top-scorers are precision recall. It is
the cheapest category to generate and it makes the easy shortage worse.
**New: an editorial gate** (`scripts/quiz-factory/editorial.mjs`). True + trusted ≠ publishable:
research surfaced hooligan-firm facts (West Ham's ICF, Millwall Bushwackers, Seaburn Casuals)
from tier-1/2 sources. Fired on 4 of 20 clubs. Drops violence/crime/tragedy/abuse at the FACT
stage; deliberately conservative about football idiom ("crushed 5-1", "fired a shot").)

**Previously confirmed:** 2026-07-17 (**Profile page redesigned + a silent P1 fixed** — the page now
leads with a *ladder* (2 players above / you / 1 below, a progress bar and "one 38-0 win does
it"), a *trophy cabinet* of verified bests per game where an unplayed game is a dashed empty
slot, and a *"where your points come from"* band that says out loud which games earn nothing
toward Rank. Killed the Lobbies/Friends tiles and the dead solo-challenge block.
**The P1:** `/profile` selected `room_scores.created_at`, a column that does not exist — the
query errored, so **quiz accuracy, recent multiplayer and recently-played-with had rendered
empty for every user since launch**. Accuracy is now true lifetime across quiz + lobbies + WC
Mastermind (`get_profile_accuracy`); "Games" counts real rows because `profiles.games_played`
is 0 on all 9,400 profiles; best-quiz is questions-right, not score/max_score (score carries
speed bonuses, so it read "5950/4800"); best-WC-run is a real max, not an unordered
`.limit(50)` of 22k rows. Migration **82** adds `get_yourscore_ladder`, `get_profile_accuracy`,
`get_best_wc_run`, `get_best_quiz`; streak maths extracted to `src/lib/streak.ts` and shared
with the home dashboard. ⚠️ **OPEN — `yourscore_user_ratings` is wrong:** it joins
`draft_standings` on `league_id` only, ignoring `competition`, so 340 users get **two ranks**
and 280 have their 38-0 score **split across PL/WC and never summed** (worst case `goat1993`,
−114,000 pts). Every user's rank is inflated by 358 phantom rows. Not fixed — it changes real
ranks and was explicitly out of scope. See `challenge_attempts`: 0 rows, no writer, so the
`SUM(challenge_attempts.score)` half of `knowledge_score` is permanently 0.)
**Also confirmed:** 2026-07-20 (**Conversion-event schema completed for the ad relaunch** —
new pixel events: `FantasyWaitlist` (Meta `Lead`/TikTok `SubmitForm`, fires on waitlist
save success in WaitlistCard — blog + Matchweek fantasy tab), `ClubPick` (ClubPicker
confirm, `{club}` param), `InviteAccepted` (viral-loop RECEIVE side — league join,
38-0 challenge accept, live-H2H code claim, WC-H2H join, group-challenge join; Share
remains the send side), `HabitFormed` (3rd distinct play-day, once per device — fired
from the ReturnPlay path in trackGame.ts), `TeamDrafted` (full XI complete on
/38-0/play — the pre-match IKEA moment), web `PushOptIn` twin in lib/push.ts, and
GA4-only `trackDiag` (`redraft_used`). EVERY pixel event now carries
`client: "native"|"web"` so app-webview activity is separable from web (the iOS app
wraps yourscore.app — pixels fire in both). Accuracy fixes: fire-once guards moved to
sessionStorage (`firedOnce`/`hasFired` in trackGame.ts) so refresh can't double-count —
38-0 match result, live H2H, live-match quiz, multiplayer quiz; multiplayer quiz "play"
now fires on the player's FIRST ANSWER (room viewers no longer count); group-quiz
starts correctly tagged `mode:"group"`. X Events Manager audit same day: all events
code-defined, no URL rules. NEW-GAME RULE: a new quiz PACK needs nothing (tracking
lives in the page); a new game PAGE must call trackGamePlay/Complete + get a GameId.
Prior confirm 2026-07-19: **Nav: 38-0 now lives under the Play tab** — Quiz | 38-0
game switcher on both hubs, see §9 + Recently Shipped. Prior confirm 2026-07-16:
**Perfect 10 — new standalone list game SHIPPED to prod.**
Third Quiz game-type ("name everyone in a ranked top-10 football list", e.g. all-time
PL top scorers): tapering "floodlit tower" of 10 rungs (#1 narrowest at the top) that
ignite gold as solved; free-text input with autocomplete chips (tap chip = submit, NO
submit button; word-exact/surname matches rank above prefix matches); 3 strikes
(wrong player = strike + tower shake); 3 hint tokens spent per-rung (tier 1 clubs clue
→ tier 2 "starts with"; clue chips persist under the rung until solved, no rung
restyle); scoring +10 clean / +6 one hint / +3 two hints; dots per rung = one per
letter, grouped by word (server-sent lengths — answers NEVER reach the client
pre-solve; grading is server-side vs service-role-only `p10_lists.entries`). Daily
list by Europe/London date; win = tower-ignition cascade, 3 strikes = missed names
revealed in red. Signed-in attempts persist (`p10_attempts`, unique per list+user,
share_token drives the async challenge link `?c=` → same list, side-by-side compare);
guests play via localStorage (house guest pattern, sign-up nudge on results). Guess
pool = ALL PL history: `p10_players` + `public/perfect10/players.json` (4,669 names)
backfilled live from SportMonks league-8 season squads 2003/04→now
(`scripts/perfect10/build-player-index.mjs` — validates every season against the
verified "season id aliases to current squad" trap; SportMonks' topscorers endpoint is
UNRELIABLE for historical rankings, verified live, so lists are NOT SportMonks-ranked);
pre-2003 legends are force-inserted whenever a list ships. Lists are authored+verified
by `scripts/perfect10/generate-lists.mjs` (author → per-entry independent web-search
verification, any failed entry drops the WHOLE list → insert as draft; a list only
serves once it's assigned a `day`). Migration 85 applied to prod (tables RLS
deny-all/service-only). Hub tile on /play, gold #ffc400; typographic placeholder cover
pending approved key art. **Same day: the playable LIBRARY shipped** (founder model:
a list drops daily, the back-catalogue stays playable) — `library` API action +
"Previous days" on the intro with PLAY / n-of-10 / score badges; `?list=` replays any
served list; drafts/future days unreachable (`isServed` gates state/guess/hint).
**(2026-07-18 pm: daily framing DROPPED from the UX — founder: "forget this daily
thing." Every list is a GAME MODE in one "Game modes" picker; dates/"today" never
reach the player. `day` remains the server-side release gate/order only.)**
**GAMEPLAY NEVER SCROLLS (Jul 17, founder requirement).** The play screen is `height:100dvh` + `overflow-hidden` (NOT `min-h-screen`/100vh — vh ignores mobile browser chrome, which is what caused 301px of overflow at 375x667); rungs are `flex: 1 1 auto` in a `min-h-0` column so tall screens fill without dead air and short ones compress; hint chips are one line and scale to full tower width so a paid clue isn't truncated. **Verify layout at 360x600 / 375x667 WITH hints spent — never at a bare 812 viewport.** **SINGLE-SOURCE ANCHOR SHIPPED (Jul 17) — the tie problem is SOLVED.** `generate-lists.mjs --anchor "<source + its tiebreak rules>"` switches the verifier from "find an article printing this exact numbering" (impossible for tied stats) to "verify the player's stat value per this source, and that the rank is defensible under its published tiebreakers" — stricter on FACTS, looser on editorial order. Rationale: **a tie never reaches the player** (they type names; the rank is display only). First run took the 2026 WC list from 0/10 to 7/10 confirmed, resolving Messi/Mbappé 8-8 (assists), Kane/Bellingham 6-6 (minutes) and Dembélé/Oyarzabal 5-5 (assists). Also withdrew `/tenable` (an earlier prototype under a name that is another party's registered trademark for this exact format) — 301s to Perfect 10; the LukePingu partner page now points at Perfect 10. **TIES WERE THE #1 GATE KILLER — and the unlock is a single-source anchor (Jul 17).** The verifier needs a source confirming an EXACT rank; most football top-10s are tie-bunched so none exists. 2026 WC top scorers DROPPED (Messi 8 = Mbappé 8, Kane 6 = Bellingham 6, Dembélé 5 = Oyarzabal 5, four players on 4) — **the final will not fix this, ties only grow.** Note **ties don't affect gameplay** (players type names; the rank is never needed) — the order only has to be defensible for display. Fix: anchor titles to ONE canonical source with published tiebreakers (FIFA Golden Boot = goals → assists → fewer minutes; Transfermarkt for fees) and verify against that source only. NOT built — needs founder sign-off. **TOPIC SHAPES THAT CANNOT SHIP (Jul 16–17):** (a) **fee-ranked lists** — all four transfer topics (most expensive PL / all-time / biggest PL sales / summer-2026 window) were DROPPED because no canonical ranking exists (Wirtz #7/#3/#2, Coutinho #4/#3/#11 across sources); shipping transfers needs the title anchored to ONE named source ("per Transfermarkt") + a gate change — NOT built. (b) **shared awards** — "last 10 PL Golden Boot winners" was factually CONFIRMED but 3/10 seasons were shared, giving untypeable rungs ("Salah, Mané & Aubameyang") → status='unplayable-shared-award', never released. **LIVE Jul 17: Last 10 Ballon d'Or Winners** (Messi ×4 / Ronaldo ×2 — double-winner grading verified on prod). **RECALL WINDOW = the topic test (Jul 16, proven live):** the "last 10 WC Golden Boot winners" list was VETOED by the founder (40-year window) and the data agreed — 3 real players all scored 0 pts, 0/10 found. Pulled to status='vetoed'; the WC captains/Golden Ball lists were pulled to draft unreleased. A verifiable list is NOT a playable list — a casual fan must land 5–7. Topic titles get founder approval as TEXT BEFORE any generation spend. **Content live:** Jul 13–15 = PL library seeds (25/26 scorers · appearance makers ·
all-time scorers), Jul 16 = last 10 WC Golden Boot winners (Salenko added as an
accepted answer on the shared-1994 rung), Jul 17 = last 10 WC-winning captains —
founder wants WC-themed dailies while WC 2026 runs; Jul 18 = last 10 WC Golden Ball winners (Messi twice → the DOUBLE-WINNER fix same eve: solved names stay suggestible, grading skips to the next unsolved rung, all-solved returns alreadyFound with NO strike). Gate lessons (all drops were
CORRECT): tie-bunched topics (all-time assists 94-94, clean sheets 132×3, mid-
tournament tallies) are structurally unshippable — pick recency-ranked or clean-order
topics; all-time WC scorers/appearances regenerate AFTER the Jul 19 final. ⚠️ NO
daily automation yet — someone must generate + assign `day` rows (founder decision
pending on a cron). NOTE: `scripts/lib/anthropic.mjs` got its first git commit on this
branch (was untracked WIP from the quiz-factory session) — reconcile if the factory
branch commits its own copy. Nav decision RULED 2026-07-18: founder ordered "all
games under one Play tab incl. 38-0" — SHIPPED same day (see §9 Navigation Canon +
Recently Shipped).)

**Previously confirmed:** 2026-07-13 (**Product-audit fix batches A–C verified + merged with main** —
see Recently Shipped; audit docs at `docs/AUDIT-2026-07-11-*.md`. Verification was live:
room-watchdog e2e 12/12 against the real DB via two QA bots, the full guest 38-0 loop
played through win→swap and loss, h2h accept + guest game-link gate exercised in the
browser. It also CAUGHT AND FIXED a P0: `loadTeam()` ran its drop-unknown-players
migration while the lazy 2.6MB player pool was still cold — `getPlayer()` returns
undefined for every id then — so any cold navigation to a loadTeam() caller (deep
link/refresh on /38-0/swap, pens, challenge/league pages) silently WIPED the guest's
whole team and PERSISTED the wipe. The migration now only runs once the pool is loaded.
Same-session deferred pickups: team-page sign-up prompts carry `?next=/38-0/team`; the
logged-out landing's dead "before Jun 11" dates replaced with evergreen copy; the landing
+ quiz-intro scoring explainers now show the real engine (×2 under 6s / ×1.5 under 12s /
+50 streak — the old "+200 pts" / "Instant 1,000" tiles were fiction); push "Maybe later"
snoozes 7 days instead of killing every ask forever (`snoozePushPrompt`, lib/onboarding);
and the £25 giveaway is RETIRED (founder 13 Jul: "There's no giveaway live") — all four
WIN £25 surfaces (quiz results, season scorecard, live-match result, WC-run result) plus
the WC share page are now plain "SHARE YOUR SCORECARD / Post it on 𝕏" actions with the
giveaway phrasing stripped from every share-tweet string; the £25 sheets are deleted.
Post-loss recovery shipped the same day: the loss scorecard offers **REDRAFT A POSITION →**
(`/38-0/redraft`) — re-spin any slot, but each position gets exactly ONE redraft over the
team's life (`team.redraftedSlots`); the post-WIN one-slot swap is unchanged. Also same day: **blog waitlist capture is live** —
a one-field "get gameweek-1 access" card on every blog post + the /blog index
(`WaitlistCard`), POSTing to `/api/waitlist` (IP rate-limited, server-validated) which
stores contacts in the Resend audience **"Fantasy Waitlist"** (resolved/created by name
at runtime; audience id e1d3b3ca-5913-417c-aef1-545db9bd35d8). ⚠️ Prod needs
`RESEND_CAMPAIGNS_API_KEY` added to Vercel env (the base RESEND_API_KEY is sending-only
and 401s on /audiences) — until then the endpoint 502s in prod.)
**Previously confirmed:** 2026-07-12 (**Guest quiz "save your score" + WC Mastermind
position drafting — SHIPPED to prod 2026-07-12.**
(1) A guest who finishes a solo quiz now sees a highlighted **"You" row at their true rank**
on the pack leaderboard (below a full 25-row page it shows "N+"), the sign-up card says
exactly which spot they'd claim, and the run is held locally (`quiz:guest-result:v1`, 48h)
and **auto-submitted to `/api/quiz/solo-complete` when they return signed-in** — SIGN UP &
SAVE SCORE genuinely saves that exact run (server re-grades; local copy never trusted).
**The guest row is render-only, visible only on that guest's own device** — nothing is
written until they sign up, so other players' leaderboards are never polluted (founder
requirement, confirmed).
(2) **WC Mastermind: tap an empty pitch slot to scout that exact position** (all draft modes
incl. ranked + open WC Run; target cleared after each placement). Ranked stays verifiable:
the per-pick `target` slot rides the slate request AND the submit (`targets[]`), is folded
into the server seed (`…:step:k:target:<slot>`; untargeted seeds unchanged → old clients
verify as before), and `verifyRankedDraft` replays it. Caveat flagged to the founder: a
modified client could fish slates across targets — bounded, deliberate trade-off.
(3) **Streak-1 draft band retuned up** (founder: a player who got their first question
right complained the first deal was too weak — "stronger from the start" meant TUNING,
not messaging; no copy changed): first correct answer now deals **70–80 OVR (was 66–76)**
— `QUIZ_BASE_FLOOR` 66→70, `QUIZ_BASE_CEILING` 76→80, `QUIZ_CEILING_STEP` 3→2 so **elite
(88+) still opens exactly at streak 5** per the Jun 18 rebalance. Deep-streak ceilings are
marginally lower (s6 90 vs 91, s8 94 vs 97). Deploy note: anyone MID-ranked-draft when
this lands would fail `verifyRankedDraft` on submit (band changes the replayed slates) —
same accepted window as the Jun 18 rebalance.)

**Previously confirmed:** 2026-07-11 (**YourScore Fantasy Football — Phase 1 MVP
built (branch `your-pl-xi/gate-generator`, not yet merged).** The 4th game, formerly
"Your PL XI". Locked model: build a **15-man squad ONCE** (2GK/5DEF/5MID/3FWD, £100m,
max 3/club, 4-man bench + auto-subs) → each gameweek a **knowledge round earns TRANSFER
CREDITS** (curve B: 5+→1, 7+→2, 9+→3, 11→4; bank cap 5) → extra moves cost −4 pts →
captain ×2 (carry-over → vice → best-form default chain) → **real-gameweek YourScore
points** from SportMonks match facts (deterministic, **no BPS-style bonus, ever**;
validated at the familiarity ceiling, Spearman 0.99 vs FPL actual). Wildcard: 1 issued
per half-season + 1 minted by a perfect round (max 1 bonus/half). Competitions =
**calendar-month tables** (season behind as prestige); deadline = FPL's convention
(90 min before the GW's first kickoff). Live at **/fantasy** (+ /api/fantasy/*,
migration 76: fantasy_gameweeks/squads/entries/player_scores). Phase 1 excludes chips,
wildcards, leagues, share cards. Dev **replay mode** scores real 25/26 gameweeks until
the season starts 21 Aug. Spec: `docs/your-pl-xi-design.md`; research + validation:
`docs/fantasy-transfer-research.md`; sims/tests: `scripts/fantasy/*`.)

**Previously confirmed:** 2026-07-10 late (**Social cards fixed — robots.txt was
blocking every OG image** — the Jul 9 robots.ts shipped `Disallow: /api/` for all agents,
and every preview image lives under /api (og/*, draft/*-og, club-preview), so X, Facebook,
LinkedIn, Slack, Telegram, WhatsApp and Discord silently unfurled with no image from that
day. robots.ts now names the link-preview crawlers (Twitterbot, facebookexternalhit,
Facebot, LinkedInBot, Slackbot-LinkExpanding, TelegramBot, WhatsApp, Discordbot, redditbot,
Applebot) with `Allow: /` minus /admin, and the AI + `*` groups carry explicit `Allow:` rules
for each OG path ahead of the /api disallow. /api and /admin remain closed to everything else.)
Same day (**Debate OG card accepts `?day=`** —
`/api/og/debate?day=YYYY-MM-DD` renders that exact day's debate card instead of
today's (regex-validated; default behaviour unchanged, crawler caching unchanged).
Used by the Studio content dash to preview the whole week's upcoming debate cards
exactly as they'll unfurl on X. Debates are world-readable seeded content, so
early visibility is deliberate and fine.)
Previously 2026-07-09 (**Blog scaffold live on yourscore.app** —
founder approved blog-as-path on the main domain for SEO authority consolidation
(unblocks Week 1 of the Your PL XI launch plan). /blog index + /blog/[slug] render
MDX from `content/blog/*.mdx` (frontmatter: title, description, date, tags,
optional ogImage, draft — drafts excluded from index/params/sitemap/RSS), fully
static (generateStaticParams + force-static; dynamicParams=false so unknown slugs
404 at the edge — zero app-runtime impact). Per-post metadata + OpenGraph article
tags + Article JSON-LD; OG fallback is a **typographic gold-on-pitch plate** at
/api/og/blog (deliberately no artwork — the locked contact-sheet-approval rule);
RSS 2.0 at /blog/rss.xml. Also the site's **first-ever sitemap.ts + robots.ts**
(Search Console verified same day per marketing session; prod previously 404'd
both) — sitemap covers /, /play, /38-0, /how-it-works, /debate, /leaderboard,
/blog + posts, legal pages (all verified 200 logged-out); /api and /admin
disallowed; per-user profile/league pages deliberately excluded (build-time DB
fetch + thin content). **AI crawlers explicitly allowed** in robots.ts (founder
decision: get YourScore cited in AI answers) — GPTBot, ClaudeBot, Claude-Web,
PerplexityBot, Google-Extended, Applebot-Extended, CCBot named, /api + /admin
still off-limits to all. **/llms.txt live** (static route) with the
founder-approved entity line (incl. Your PL XI mid-Aug launch) + key-page
links — wording changes need marketing sign-off. **FAQPage JSON-LD supported** via frontmatter `faq:`
list — one source drives both the rendered "Quick answers" accordion and the
schema (NOT body comments: HTML `<!-- -->` comments break MDX builds — see
content/blog/README.md, the authoring guide). Publishing = commit an
.mdx to content/blog/ and deploy; seed post "Welcome to the YourScore blog"
(with live FAQ) is ready. New deps: next-mdx-remote, gray-matter. Build note:
next.config.mjs now
honours a NEXT_DIST_DIR env override so verify builds don't clobber a running dev
server's .next; verified with a real `next build` — all blog routes emit static.)
Same day (**WC Mastermind gate answers recorded** —
ranked run creation now persists the gate quiz per-question detail on the run row
(`draft_wc_runs.quiz_answers` jsonb, migration 76): question, letter-keyed options,
correct letter, the player's pick, correctness — all server-derived (the server
already re-grades the gate; nothing new is trusted from the client). Feeds the
content pipeline (Question Guru / hardest-question stats) so Mastermind players —
the biggest daily pool — power those formats. E2E-verified via a full ranked
draft as the health bot; no client change; data accrues from deploy onward.)
Previously 2026-07-07 late (**Tap guard + nav progress** —
founder: "the app is really sensitive as I'm scrolling, it accidentally clicks
into different areas… and the loading between screens is a little too long."
`TouchGuards` in the root layout: capture-phase click filter kills phantom taps
(finger moved >8px measured touchstart→click, since browsers drop touchmove
below their own ~15px slop and STILL fire click; plus any tap landing <100ms
after a scroll event — momentum taps stop the scroll, they don't open things),
and paints an instant 3px teal top progress bar on internal-link taps so
navigation is acknowledged immediately. E2E-verified: scroll-drag + 12px jitter
no longer navigate, clean taps do. Measured nav (4x CPU throttle): picker→quiz
~1s, back 37ms, tab switch ~150ms — deeper page-weight work is the open lever.)
Same day (**Quiz covers shown whole + CDN crop bug
fixed** — founder: covers are designed cards (logo + title baked in); size the CARD
to the image, never crop the art. Root cause of "images don't fit at all":
`coverUrl()`'s Supabase render transform with only `width` centre-crops the sides —
`resize=contain` now appended in `src/lib/img.ts`, fixing every cover in the app at
once. Card media zones in /play + /versus/quiz take the image's own aspect
(`w-full h-auto`); Q/New chips sit at the BOTTOM of covered cards (off the baked
title strip); home featured + versus hero backdrops crop from the bottom (pure art —
the HTML overlay carries the title); /challenges hero shows the cover whole. Also
`fetchCache="force-no-store"` on api/quiz/packs, api/challenges/pack,
api/cron/wc-mastermind — the durable Data Cache was pinning pack reads, so metadata
edits never reached the app between deploys. PROCESS RULE (founder, after an
unapproved art batch went live): **generated imagery/brand creative NEVER ships
without agreed art direction + contact-sheet approval.** The ~48 new artworks now on
previously-coverless packs (records/EOS evergreens + 4 June dailies + variants) are
unapproved placeholders pending replacement. STYLE SYSTEM LOCKED same day after a
four-direction sample review: **retro matchday poster = base · fan's-eye terraces
in rotation · cinematic story + comic ink reserved for big moments.** The daily
pipeline (gen-quiz-images.mjs) now rotates poster/terraces by date; each
Regenerate press on the Telegram gate steps poster → terraces → story → ink;
`--style N` forces one; poster palettes rotate daily; a dark scrim keeps titles
readable on bright poster art. The 19 regenerated covers went through
contact-sheet review and founder revisions (black plates behind every headline;
real club crests composited INTO the artwork — Panini-style sticker rows on the
records posters, a Man Utd/Man City pair on The Derbies, corner crest on club
cards; bigger crests in the rail/picker; hard FOOTBALL-ONLY rule in every art
prompt — never American football imagery) and are **LIVE (approved Jul 7)**:
uploaded to quiz-share/<slug>-art.png with the ~29 records variants inheriting
their parent's poster. Crests always composited from public/badges/, never
model-drawn. Same day: the nine postered records evergreens (PL/CL/Euro/WC
Records, Golden Boot, Iconic Managers, Penalty Shootout Lore, The Derbies,
Transfer Market) switched to rotation_active=true — the picker's Records tab
is now a stocked catalogue (9 packs) instead of one.)
Previously 2026-07-05 round 6 (**Anonymous debate voting** —
nobody needs an account to vote on the daily debate. Guests vote under a per-device
key (`debate_anon_votes`, migration 72; localStorage `ys:debate:voter`), votes
remembered on-device, rate-limited per IP; `?pick=N` share links auto-cast for
guests on landing — the tap on X IS the vote. The split counts account + anonymous
votes together. **Sign-up now gates the argument (comments), not the ballot** — a
post-vote nudge invites guests in. Accepted trade-off: device keys are spoofable;
debates are banter, not the £100 board.)
Same day, round 5 (**Debates are date-allocated,
not rotated** — founder: one per day, allocated to dates, reviewable in advance,
keep it very simple. Migration 71 adds `debates.day` (unique); "today's debate" =
the row dated today (UK), else the most recent past one. **The schedule IS
`scripts/seed-debates.mjs`** — literal dates Jul 5 → Aug 5, edit + re-run to change;
`--list` prints the calendar. The earlier modulo rotation switched the live debate
mid-day when the bank changed (scarves→Gazza, 27 votes mid-flight) — scarves
restored to Jul 5 with votes intact, Gazza scheduled Jul 6.)
Same day, round 4 (**Debate share card** — the
/debate link unfurl is now a pixel-copy of the in-app Daily Debate tile: gold header,
question, UNVOTED option buttons with tick circles (founder call: buttons, not the
split — the whole point is landing people on yourscore.app). `/debate?pick=N`
per-side links pre-highlight the option for guests and auto-cast the vote once
they're signed in — the tap on X *is* the vote, sign-up is the gate. No native X
poll (deliberate: don't give X the engagement). Rotation order now has an `id`
tiebreaker (seeded rows share created_at) and the OG fetch is no-store.)
Same day, round 3 (**Back navigation retraces steps**
— founder: "when they go back, they just want to retrace their steps". Session nav
trail (`src/lib/nav.ts` + NavTracker in the root layout) + `BackPill fallback=` mode:
back controls now return the player to the screen they actually came from, skipping
transient screens (matchmaking radar, game rooms, auth) and falling back to the old
hardcoded target only on deep links. Rolled out to: player profiles, league tables
(quiz + 38-0 via DraftHeader), scorecards, quiz picker/find/challenge/shadow,
featured-quiz detail, /debate (which previously had no back at all). New **nav layer
in the 4x/day health checks** (`scripts/health/checks/navigation.mjs`) walks the
golden paths in a real browser and fails the Telegram scorecard if back stops
retracing.)
Same day, round 2 (**Home v3 polish**: zero-streak
copy is positive ("START A STREAK", never "no streak" — first thing a player reads);
**Today's Debate card moved from Versus to the home page** (one-tap ballot with tick
circles + "Tap one — that's your vote, done." microcopy; full argument thread stays
at /debate); featured quiz card carries a gold **WORLD CUP QUIZ SERIES** chip
(metadata.series="wc2026") + posted date; **debate editorial bar**: every debate must
be real and specific — an actual moment/player/rule/part of fan life — and work for
every fan, not just big-club fans (bank rewritten in scripts/seed-debates.mjs, which
is authoritative: it deactivates active debates not in its list). GOTCHA fixed:
service-role supabase GETs in route handlers get pinned forever by Vercel's data
cache (constant cache key) — debate/comments routes + home now set
`fetchCache = "force-no-store"`.)
Same day, round 1 (**Home v3** — signed-in home rebuilt to
the founder's "Version 3" mockup: compact progress card with real day-streak +
weekday play-dots + points + global rank + chase line, a Rivalries module (live h2h
challenge with real expiry countdown, else all-time head-to-head record), a
full-width Featured Quiz play-now card, a behaviour-based "Because you played 38-0 /
Picked for you" rail of unplayed packs, and a compact 3-up mode-tile row replacing
the full-width game tiles. All stats real; leagues + open-lobby nudge + pending
notices kept. `src/app/page.tsx` + `src/components/home/Dashboard.tsx`.
Previously 2026-07-04: **Versus phase 2**: daily debates +
discussion threads — §9, migration 70. Previously 2026-07-03: **Versus phase 1 +
rounds 2–3**: Play-tab
redesign, instant matchmaking for both games incl. pick-your-quiz, shadow matches,
results-feed highlights, public leagues — §9. Previously 2026-06-30:
**Versus tab** replaces Leagues — §9;
async multiplayer Phases 1–2 + group challenges shipped, see §7; native track:
challenge push + universal links + haptics).
Earlier: 2026-06-16 (World Cup Daily + World Cup H2H — §5B, migration 39; interactive
penalties — migration 35). Prior full reconciliation 2026-06-10 against `src/` + migrations.
**Updated 2026-06-14:** added **Club Leagues** (built, not live — migration 36 + push pending).
**Updated 2026-06-16:** **World Cup** reorganised into **two modes** — **World Cup
Mastermind** (daily quiz-gated ranked run + Practice, season board) and **World Cup Run**
(open, no-quiz draft). **Nation / National-Team mode retired** from the UI. World Cup is
now the **first/default tab** in 38-0. A drawn knockout (and the 3-pt qualification
play-off) is the **player's choice**: take an interactive **penalty shootout** OR answer
one more **World Cup quiz question** (25s) to go through. **Shipped to prod** (migrations
35 + 39 applied).
**Updated 2026-06-18:** **World Cup Mastermind rebalanced so knowledge pays off.**
(1) Opponent difficulty no longer rubber-bands to your own Strength — each round is a
**fixed standard** (group 68 · R32 72 · R16 75 · QF 79 · SF 83 · Final 87, in `wc.ts`
`OPP_TARGET`/`oppTargetFor`). A well-drafted XI (≈84 Str) is now the favourite from the
group through the semi and a slight underdog only in the Final; a weak XI is found out in
the knockouts. (2) The draft band's **ceiling now climbs with the correct-answer streak**
(`draft-quiz.ts` `QUIZ_BASE_CEILING`/`QUIZ_CEILING_STEP`) — a lone correct answer deals a
solid (sub-elite) player; **elite players (~88+) only unlock around a streak of 5**, so the
best players come up toward the end of the draft once you've earned them.
